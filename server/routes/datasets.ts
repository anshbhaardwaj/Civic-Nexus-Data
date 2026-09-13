/** /api/datasets/*, /api/lineage/*, /api/anomalies/* */
import { Router } from 'express';
import { z } from 'zod';
import { db, safeIdent } from '../db';
import {
  datasetSummary,
  getColumns,
  getRows,
  listDatasets,
  mustDataset,
} from '../lib/datasets';
import { ApiError, asyncHandler, audit, requireAuth, requirePermission, v, validate } from '../lib/http';
import { ingestText } from '../lib/ingest';
import { runAnomalyScan } from '../ai/anomaly';

export const datasetsRouter = Router();
datasetsRouter.use(requireAuth);

const refParam = z.object({ id: z.string().min(1) });

datasetsRouter.get(
  '/',
  requirePermission('datasets.read'),
  asyncHandler((_req, res) => {
    const datasets = listDatasets().map(datasetSummary);
    res.json({
      datasets,
      totals: {
        datasets: datasets.length,
        rows: datasets.reduce((a, d) => a + d.rows, 0),
        piiColumnsMasked: datasets.reduce((a, d) => a + d.piiColumns, 0),
        rejects: datasets.reduce((a, d) => a + d.rejects, 0),
      },
    });
  }),
);

/** Upload + ingest through the full 10-step pipeline. */
const ingestSchema = z.object({
  slug: z.string().min(2).max(60),
  name: z.string().min(2).max(120),
  domain: z.string().min(2).max(60).default('Custom'),
  description: z.string().max(400).default('Uploaded via /api/datasets/ingest'),
  sourceFile: z.string().max(120).default('upload.csv'),
  format: z.enum(['csv', 'json']).default('csv'),
  content: z.string().min(10).max(20_000_000),
});

datasetsRouter.post(
  '/ingest',
  requirePermission('datasets.ingest'),
  validate({ body: ingestSchema }),
  asyncHandler((req, res) => {
    const body = v<z.infer<typeof ingestSchema>>(req, 'body');
    const result = ingestText(
      body.content,
      {
        slug: body.slug,
        name: body.name,
        domain: body.domain,
        description: body.description,
        sourceFile: body.sourceFile,
        actor: req.user!.email,
        actorRole: req.user!.role,
      },
      body.format,
    );
    const scan = runAnomalyScan({ datasetId: result.datasetId, replace: true });
    audit(req, 'dataset.ingest_upload', `dataset:${result.slug}`, { rows: result.rows, rejects: result.rejects });
    res.status(201).json({ ingest: result, anomalyScan: scan });
  }),
);

datasetsRouter.get(
  '/:id',
  requirePermission('datasets.read'),
  validate({ params: refParam }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ id: string }>(req, 'params').id);
    const cols = getColumns(ds.id);
    const lineage = db
      .prepare('SELECT step_no, step, status, rows_in, rows_out, duration_ms FROM lineage_steps WHERE dataset_id = ? ORDER BY step_no')
      .all(ds.id);
    res.json({
      dataset: datasetSummary(ds),
      columns: cols,
      lineageSummary: lineage,
      anomalies: (db.prepare('SELECT COUNT(*) AS n FROM anomalies WHERE dataset_id = ?').get(ds.id) as { n: number }).n,
      preview: getRows(ds, { limit: 5 }),
    });
  }),
);

datasetsRouter.get(
  '/:id/columns',
  requirePermission('datasets.read'),
  validate({ params: refParam }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ id: string }>(req, 'params').id);
    res.json({ dataset: { id: ds.id, slug: ds.slug }, columns: getColumns(ds.id) });
  }),
);

const rowsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  orderBy: z.string().max(64).optional(),
});

datasetsRouter.get(
  '/:id/rows',
  requirePermission('datasets.read'),
  validate({ params: refParam, query: rowsQuery }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ id: string }>(req, 'params').id);
    const q = v<z.infer<typeof rowsQuery>>(req, 'query');
    const cols = getColumns(ds.id);
    if (q.orderBy && !cols.some((c) => c.name === q.orderBy)) {
      throw ApiError.validation(`Unknown column '${q.orderBy}'`, { columns: cols.map((c) => c.name) });
    }
    res.json({
      dataset: { id: ds.id, slug: ds.slug, rows: ds.row_count },
      limit: q.limit,
      offset: q.offset,
      rows: getRows(ds, { limit: q.limit, offset: q.offset, orderBy: q.orderBy }),
    });
  }),
);

datasetsRouter.get(
  '/:id/rejects',
  requirePermission('datasets.read'),
  validate({ params: refParam }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ id: string }>(req, 'params').id);
    const rows = db
      .prepare('SELECT id, source_line, reason_code, reason, raw_row, created_at FROM ingest_rejects WHERE dataset_id = ? ORDER BY id LIMIT 500')
      .all(ds.id);
    res.json({ dataset: { id: ds.id, slug: ds.slug }, total: ds.reject_count, rejects: rows });
  }),
);

/** Masked export: the cleaned dataset, with 0 raw-PII values by construction. */
datasetsRouter.get(
  '/:id/export-masked',
  requirePermission('datasets.export'),
  validate({ params: refParam, query: z.object({ format: z.enum(['csv', 'json']).default('csv') }) }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ id: string }>(req, 'params').id);
    const format = v<{ format: 'csv' | 'json' }>(req, 'query').format;
    const cols = getColumns(ds.id);
    const names = cols.map((c) => c.name);
    const rows = db.prepare(`SELECT ${names.map(safeIdent).join(', ')} FROM ${safeIdent(ds.table_name)}`).all() as Record<string, unknown>[];
    audit(req, 'dataset.export_masked', `dataset:${ds.slug}`, { rows: rows.length, format, piiColumns: ds.pii_columns });
    if (format === 'json') {
      res.json({
        dataset: datasetSummary(ds),
        maskedColumns: cols.filter((c) => c.is_pii).map((c) => ({ column: c.name, kind: c.pii_kind })),
        rows,
      });
      return;
    }
    const esc = (v2: unknown) => {
      const s = v2 === null || v2 === undefined ? '' : String(v2);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [names.join(',')];
    for (const r of rows) lines.push(names.map((n) => esc(r[n])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ds.slug}_masked.csv"`);
    res.send(lines.join('\n') + '\n');
  }),
);

datasetsRouter.delete(
  '/:id',
  requirePermission('datasets.delete'),
  validate({ params: refParam }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ id: string }>(req, 'params').id);
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${safeIdent(ds.table_name)}`);
      db.prepare('DELETE FROM datasets WHERE id = ?').run(ds.id);
    })();
    audit(req, 'dataset.delete', `dataset:${ds.slug}`, { rows: ds.row_count });
    res.json({ ok: true, deleted: { id: ds.id, slug: ds.slug, rows: ds.row_count } });
  }),
);

/* ------------------------------------------------------------- lineage */

export const lineageRouter = Router();
lineageRouter.use(requireAuth);

lineageRouter.get(
  '/',
  requirePermission('lineage.read'),
  asyncHandler((_req, res) => {
    const rows = db
      .prepare(
        `SELECT d.id AS dataset_id, d.slug, d.name, COUNT(l.id) AS steps, SUM(l.duration_ms) AS total_ms,
                MAX(l.rows_out) AS rows_out
         FROM datasets d LEFT JOIN lineage_steps l ON l.dataset_id = d.id GROUP BY d.id ORDER BY d.id`,
      )
      .all();
    res.json({ datasets: rows });
  }),
);

lineageRouter.get(
  '/:datasetId',
  requirePermission('lineage.read'),
  validate({ params: z.object({ datasetId: z.string().min(1) }) }),
  asyncHandler((req, res) => {
    const ds = mustDataset(v<{ datasetId: string }>(req, 'params').datasetId);
    const steps = db.prepare('SELECT * FROM lineage_steps WHERE dataset_id = ? ORDER BY step_no').all(ds.id) as Record<string, unknown>[];
    res.json({
      dataset: datasetSummary(ds),
      steps: steps.map((s) => ({
        stepNo: s.step_no,
        step: s.step,
        status: s.status,
        rowsIn: s.rows_in,
        rowsOut: s.rows_out,
        durationMs: s.duration_ms,
        detail: JSON.parse(String(s.detail)),
        createdAt: s.created_at,
      })),
      rejects: ds.reject_count,
    });
  }),
);

/* ----------------------------------------------------------- anomalies */

export const anomaliesRouter = Router();
anomaliesRouter.use(requireAuth);

const anomalyQuery = z.object({
  datasetId: z.coerce.number().int().positive().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['open', 'acknowledged', 'dismissed']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

anomaliesRouter.get(
  '/',
  requirePermission('anomalies.read'),
  validate({ query: anomalyQuery }),
  asyncHandler((req, res) => {
    const q = v<z.infer<typeof anomalyQuery>>(req, 'query');
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.datasetId) {
      where.push('dataset_id = ?');
      params.push(q.datasetId);
    }
    if (q.severity) {
      where.push('severity = ?');
      params.push(q.severity);
    }
    if (q.status) {
      where.push('status = ?');
      params.push(q.status);
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM anomalies${clause}`).get(...params) as { n: number }).n;
    const rows = db
      .prepare(`SELECT * FROM anomalies${clause} ORDER BY score DESC LIMIT ? OFFSET ?`)
      .all(...params, q.limit, q.offset);
    res.json({ total, limit: q.limit, offset: q.offset, anomalies: rows });
  }),
);

anomaliesRouter.get(
  '/summary',
  requirePermission('anomalies.read'),
  asyncHandler((_req, res) => {
    const bySeverity = db.prepare('SELECT severity, COUNT(*) AS n FROM anomalies GROUP BY severity').all();
    const byDataset = db
      .prepare('SELECT dataset_slug, COUNT(*) AS n, MAX(sigma) AS max_sigma FROM anomalies GROUP BY dataset_slug ORDER BY n DESC')
      .all();
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM anomalies GROUP BY status').all();
    res.json({
      total: (db.prepare('SELECT COUNT(*) AS n FROM anomalies').get() as { n: number }).n,
      bySeverity,
      byDataset,
      byStatus,
      method: 'AI-1: MAD primary (3.5σ), corroborated by z-score (3σ) and IQR (1.5×IQR)',
    });
  }),
);

anomaliesRouter.get(
  '/:id',
  requirePermission('anomalies.read'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler((req, res) => {
    const id = v<{ id: number }>(req, 'params').id;
    const row = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw ApiError.notFound(`Anomaly ${id} not found`);
    const ds = mustDataset(Number(row.dataset_id));
    const sourceRow = db
      .prepare(`SELECT * FROM ${safeIdent(ds.table_name)} WHERE row_id = ?`)
      .get(Number(row.source_row_id)) as Record<string, unknown> | undefined;
    res.json({ anomaly: row, dataset: { id: ds.id, slug: ds.slug, name: ds.name }, sourceRow: sourceRow ?? null });
  }),
);

function setStatus(status: 'acknowledged' | 'dismissed') {
  return asyncHandler((req, res) => {
    const id = v<{ id: number }>(req, 'params').id;
    const row = db.prepare('SELECT id, dataset_slug, column_name FROM anomalies WHERE id = ?').get(id) as
      | { id: number; dataset_slug: string; column_name: string }
      | undefined;
    if (!row) throw ApiError.notFound(`Anomaly ${id} not found`);
    db.prepare('UPDATE anomalies SET status = ? WHERE id = ?').run(status, id);
    audit(req, `anomaly.${status === 'acknowledged' ? 'ack' : 'dismiss'}`, `anomaly:${id}`, {
      dataset: row.dataset_slug,
      column: row.column_name,
    });
    res.json({ ok: true, id, status });
  });
}

anomaliesRouter.post(
  '/:id/ack',
  requirePermission('anomalies.write'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  setStatus('acknowledged'),
);

anomaliesRouter.post(
  '/:id/dismiss',
  requirePermission('anomalies.write'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  setStatus('dismissed'),
);
