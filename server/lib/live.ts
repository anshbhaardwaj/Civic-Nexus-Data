/**
 * Live-data simulator (SPEC §6): appends fresh telemetry rows to an ingested
 * dataset (one new period per dimension entity, drawn from that entity's recent
 * mean/σ with an injected spike probability) and re-triggers AI-1 so the
 * dashboard visibly changes.
 */
import { db, safeIdent } from '../db';
import { runAnomalyScan } from '../ai/anomaly';
import { appendAudit } from './audit';
import { DatasetRow, dimensionColumns, getColumns, metricColumns, timeColumn } from './datasets';
import { ApiError } from './http';
import { Rng } from './rng';
import { mean, round, stddev } from './stats';

export interface LiveTickResult {
  dataset: { id: number; slug: string; name: string };
  period: string;
  rowsAppended: number;
  entities: number;
  spikeInjected: number;
  rowCountBefore: number;
  rowCountAfter: number;
  anomalyScan: { detected: number; persisted: number; bySeverity: Record<string, number> };
  sample: Record<string, unknown>[];
}

function nextPeriod(last: string): string {
  const m = /^(\d{4})-(\d{2})(-(\d{2}))?$/.exec(last);
  if (!m) return `${last}+1`;
  let year = Number(m[1]);
  let month = Number(m[2]);
  if (month > 12) return `${year + 1}-${String((year + 2) % 100).padStart(2, '0')}`; // financial year style
  month++;
  if (month > 12) {
    month = 1;
    year++;
  }
  return `${year}-${String(month).padStart(2, '0')}${m[4] ? `-${m[4]}` : ''}`;
}

export function liveTick(ds: DatasetRow, opts: { spikeProbability?: number; seed?: string } = {}): LiveTickResult {
  const tcol = timeColumn(ds.id);
  if (!tcol) throw ApiError.notApplicable(`Dataset '${ds.slug}' has no time column, so live telemetry cannot be appended`);
  const dims = dimensionColumns(ds.id);
  const metrics = metricColumns(ds.id);
  if (!metrics.length) throw ApiError.notApplicable(`Dataset '${ds.slug}' has no numeric metrics to simulate`);
  const table = safeIdent(ds.table_name);
  const allCols = getColumns(ds.id).filter((c) => c.semantic_role !== 'identifier');

  const lastPeriod = String(
    (db.prepare(`SELECT MAX(${safeIdent(tcol.name)}) AS p FROM ${table}`).get() as { p: string }).p ?? '2025-12',
  );
  const period = nextPeriod(lastPeriod);
  const rowCountBefore = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  const groupCol = dims[0]?.name;
  const entities = groupCol
    ? (db.prepare(`SELECT DISTINCT ${safeIdent(groupCol)} AS k FROM ${table} WHERE ${safeIdent(groupCol)} IS NOT NULL`).all() as { k: string }[]).map((r) => String(r.k))
    : ['ALL'];

  const rng = new Rng(opts.seed ?? `live:${ds.slug}:${period}:${Date.now()}`);
  const spikeP = opts.spikeProbability ?? 0.18;
  let spikes = 0;
  const inserted: Record<string, unknown>[] = [];

  const insertCols = allCols.map((c) => c.name);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${insertCols.map(safeIdent).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
  );

  const tx = db.transaction(() => {
    for (const entity of entities) {
      const where = groupCol ? `WHERE ${safeIdent(groupCol)} = ?` : '';
      const recent = db
        .prepare(
          `SELECT * FROM (SELECT * FROM ${table} ${where} ORDER BY ${safeIdent(tcol.name)} DESC LIMIT 6) ORDER BY ${safeIdent(tcol.name)} ASC`,
        )
        .all(...(groupCol ? [entity] : [])) as Record<string, unknown>[];
      if (!recent.length) continue;
      const latest = recent[recent.length - 1];
      const spike = rng.bool(spikeP);
      if (spike) spikes++;
      const row: Record<string, unknown> = {};
      for (const col of allCols) {
        if (col.name === tcol.name) {
          row[col.name] = period;
          continue;
        }
        if (col.semantic_role === 'metric') {
          const hist = recent.map((r) => Number(r[col.name])).filter((n) => Number.isFinite(n));
          const mu = mean(hist);
          const sd = stddev(hist) || Math.abs(mu) * 0.05 || 1;
          let v = rng.normal(mu, sd * 0.8);
          if (spike) v = mu + Math.sign(rng.normal(1, 1) || 1) * sd * rng.float(4, 7, 2) + mu * 0.15;
          if (col.inferred_type === 'integer') v = Math.max(0, Math.round(v));
          else v = round(Math.max(0, v), 3);
          row[col.name] = v;
        } else {
          row[col.name] = latest[col.name] ?? null;
        }
      }
      stmt.run(insertCols.map((c) => row[c] ?? null));
      inserted.push(row);
    }
  });
  tx();

  const rowCountAfter = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  db.prepare('UPDATE datasets SET row_count = ? WHERE id = ?').run(rowCountAfter, ds.id);

  const scan = runAnomalyScan({ datasetId: ds.id, replace: true });

  appendAudit({
    actor: 'system@civicnexus.in',
    actorRole: 'system',
    action: 'live.tick',
    entity: `dataset:${ds.slug}`,
    payload: { period, rowsAppended: inserted.length, spikes, rowCountAfter, anomaliesPersisted: scan.persisted },
  });

  return {
    dataset: { id: ds.id, slug: ds.slug, name: ds.name },
    period,
    rowsAppended: inserted.length,
    entities: entities.length,
    spikeInjected: spikes,
    rowCountBefore,
    rowCountAfter,
    anomalyScan: { detected: scan.detected, persisted: scan.persisted, bySeverity: scan.bySeverity },
    sample: inserted.slice(0, 5),
  };
}
