/** Read helpers over the physical ds_<slug> tables. */
import { db, safeIdent } from '../db';
import { ApiError } from './http';
import type { ColType, SemanticRole } from './ingest';

export interface DatasetRow {
  id: number;
  slug: string;
  name: string;
  domain: string;
  description: string;
  source_file: string;
  table_name: string;
  row_count: number;
  column_count: number;
  reject_count: number;
  pii_columns: number;
  salt: string;
  quality_score: number;
  ingested_at: string;
  ingested_by: string;
  duration_ms: number;
}

export interface ColumnRow {
  id: number;
  dataset_id: number;
  ordinal: number;
  raw_name: string;
  name: string;
  inferred_type: ColType;
  type_confidence: number;
  semantic_role: SemanticRole;
  is_pii: number;
  pii_kind: string | null;
  null_count: number;
  imputed_count: number;
  impute_method: string | null;
  distinct_count: number;
  min_value: string | null;
  max_value: string | null;
  mean_value: number | null;
  stddev_value: number | null;
}

export function listDatasets(): DatasetRow[] {
  return db.prepare('SELECT * FROM datasets ORDER BY id ASC').all() as DatasetRow[];
}

export function findDataset(ref: string | number): DatasetRow | undefined {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    return db.prepare('SELECT * FROM datasets WHERE id = ?').get(Number(ref)) as DatasetRow | undefined;
  }
  return db.prepare('SELECT * FROM datasets WHERE slug = ?').get(String(ref)) as DatasetRow | undefined;
}

export function mustDataset(ref: string | number): DatasetRow {
  const d = findDataset(ref);
  if (!d) throw ApiError.notFound(`Dataset '${ref}' not found`);
  return d;
}

/** Resolves a dataset by explicit ref, else the first dataset that has the named column. */
export function resolveDatasetForColumn(ref: string | number | undefined, column?: string): DatasetRow {
  if (ref !== undefined && ref !== null && String(ref) !== '') return mustDataset(ref);
  if (column) {
    const hit = db
      .prepare(
        `SELECT d.* FROM datasets d JOIN dataset_columns c ON c.dataset_id = d.id
         WHERE c.name = ? AND c.semantic_role = 'metric' ORDER BY d.id LIMIT 1`,
      )
      .get(column) as DatasetRow | undefined;
    if (hit) return hit;
  }
  const first = db.prepare('SELECT * FROM datasets ORDER BY id LIMIT 1').get() as DatasetRow | undefined;
  if (!first) throw ApiError.notFound('No datasets ingested yet');
  return first;
}

export function getColumns(datasetId: number): ColumnRow[] {
  return db.prepare('SELECT * FROM dataset_columns WHERE dataset_id = ? ORDER BY ordinal ASC').all(datasetId) as ColumnRow[];
}

export function columnsByRole(datasetId: number, role: SemanticRole): ColumnRow[] {
  return getColumns(datasetId).filter((c) => c.semantic_role === role);
}

export function metricColumns(datasetId: number): ColumnRow[] {
  return columnsByRole(datasetId, 'metric');
}

export function timeColumn(datasetId: number): ColumnRow | undefined {
  const times = columnsByRole(datasetId, 'time');
  return times.find((c) => /(month|date|period)/.test(c.name)) ?? times[0];
}

export function dimensionColumns(datasetId: number): ColumnRow[] {
  return columnsByRole(datasetId, 'dimension');
}

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export function getRows(
  ds: DatasetRow,
  opts: { limit?: number; offset?: number; columns?: string[]; orderBy?: string; where?: { col: string; val: string } } = {},
): Row[] {
  const table = safeIdent(ds.table_name);
  const cols = opts.columns?.length ? ['row_id', ...opts.columns.map(safeIdent)] : ['*'];
  let sql = `SELECT ${cols.join(', ')} FROM ${table}`;
  const params: Cell[] = [];
  if (opts.where) {
    sql += ` WHERE ${safeIdent(opts.where.col)} = ?`;
    params.push(opts.where.val);
  }
  if (opts.orderBy) sql += ` ORDER BY ${safeIdent(opts.orderBy)} ASC`;
  if (opts.limit != null) sql += ` LIMIT ${Math.max(1, Math.min(200000, opts.limit))}`;
  if (opts.offset != null) sql += ` OFFSET ${Math.max(0, opts.offset)}`;
  return db.prepare(sql).all(...params) as Row[];
}

export function countRows(ds: DatasetRow): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM ${safeIdent(ds.table_name)}`).get() as { n: number };
  return r.n;
}

export function numericSeries(ds: DatasetRow, column: string): { rowId: number; value: number }[] {
  const table = safeIdent(ds.table_name);
  const col = safeIdent(column);
  const rows = db
    .prepare(`SELECT row_id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`)
    .all() as { row_id: number; v: number }[];
  return rows.filter((r) => typeof r.v === 'number' && Number.isFinite(r.v)).map((r) => ({ rowId: r.row_id, value: r.v }));
}

export function distinctValues(ds: DatasetRow, column: string, limit = 200): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT ${safeIdent(column)} AS v FROM ${safeIdent(ds.table_name)} WHERE ${safeIdent(column)} IS NOT NULL ORDER BY 1 LIMIT ?`)
    .all(limit) as { v: Cell }[];
  return rows.map((r) => String(r.v));
}

/** Aggregated time series: SUM or AVG of metric per period, optionally filtered by a dimension value. */
export function aggregateSeries(
  ds: DatasetRow,
  metric: string,
  timeCol: string,
  agg: 'sum' | 'avg' = 'sum',
  filter?: { column: string; value: string },
): { period: string; value: number; n: number }[] {
  const table = safeIdent(ds.table_name);
  const m = safeIdent(metric);
  const t = safeIdent(timeCol);
  let sql = `SELECT ${t} AS period, ${agg === 'sum' ? 'SUM' : 'AVG'}(${m}) AS value, COUNT(*) AS n FROM ${table} WHERE ${m} IS NOT NULL`;
  const params: Cell[] = [];
  if (filter) {
    sql += ` AND ${safeIdent(filter.column)} = ?`;
    params.push(filter.value);
  }
  sql += ` GROUP BY ${t} ORDER BY ${t} ASC`;
  const rows = db.prepare(sql).all(...params) as { period: string; value: number; n: number }[];
  return rows.map((r) => ({ period: String(r.period), value: Number(r.value), n: r.n }));
}

/** Group-level aggregation used by ranking/compare intents and clustering. */
export function aggregateByDimension(
  ds: DatasetRow,
  dimension: string,
  metrics: string[],
  agg: 'sum' | 'avg' = 'avg',
): { key: string; values: Record<string, number>; n: number }[] {
  const table = safeIdent(ds.table_name);
  const d = safeIdent(dimension);
  const sel = metrics.map((m) => `${agg === 'sum' ? 'SUM' : 'AVG'}(${safeIdent(m)}) AS ${safeIdent(m)}`).join(', ');
  const rows = db
    .prepare(`SELECT ${d} AS k, ${sel}, COUNT(*) AS n FROM ${table} WHERE ${d} IS NOT NULL GROUP BY ${d} ORDER BY ${d}`)
    .all() as Record<string, Cell>[];
  return rows.map((r) => {
    const values: Record<string, number> = {};
    for (const m of metrics) values[m] = Number(r[m] ?? 0);
    return { key: String(r.k), values, n: Number(r.n ?? 0) };
  });
}

export function datasetSummary(ds: DatasetRow) {
  const cols = getColumns(ds.id);
  return {
    id: ds.id,
    slug: ds.slug,
    name: ds.name,
    domain: ds.domain,
    description: ds.description,
    sourceFile: ds.source_file,
    rows: ds.row_count,
    columns: ds.column_count,
    rejects: ds.reject_count,
    piiColumns: ds.pii_columns,
    qualityScore: ds.quality_score,
    ingestedAt: ds.ingested_at,
    ingestedBy: ds.ingested_by,
    ingestDurationMs: ds.duration_ms,
    roles: {
      metrics: cols.filter((c) => c.semantic_role === 'metric').map((c) => c.name),
      dimensions: cols.filter((c) => c.semantic_role === 'dimension').map((c) => c.name),
      time: cols.filter((c) => c.semantic_role === 'time').map((c) => c.name),
      identifiers: cols.filter((c) => c.semantic_role === 'identifier').map((c) => c.name),
      pii: cols.filter((c) => c.semantic_role === 'pii').map((c) => c.name),
    },
  };
}
