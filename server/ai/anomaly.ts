/**
 * AI-1 — Statistical anomaly engine (SPEC §5).
 *
 * Primary detector: robust MAD.
 *      scaledMAD = 1.4826 x median(|x - median|)
 *      sigmaMAD  = |x - median| / scaledMAD          -> flag when > 3.5
 * Corroborating detectors:
 *      z-score   = |x - mean| / stddev               -> flag when > 3
 *      IQR       = x < Q1 - 1.5xIQR  or  x > Q3 + 1.5xIQR
 * Severity is taken from the sigma distance, boosted when detectors agree.
 * Baselines are computed per dimension group (e.g. per district) when the
 * dataset has a dimension column, otherwise globally.
 */
import { db, safeIdent } from '../db';
import { appendAudit } from '../lib/audit';
import {
  DatasetRow,
  dimensionColumns,
  getColumns,
  listDatasets,
  metricColumns,
  timeColumn,
} from '../lib/datasets';
import { mad, mean, quantile, round, stddev } from '../lib/stats';

export interface AnomalyRecord {
  datasetId: number;
  datasetSlug: string;
  sourceRowId: number;
  column: string;
  entity: string;
  period: string | null;
  value: number;
  expectedLow: number;
  expectedHigh: number;
  deviation: number;
  sigma: number;
  method: string;
  methodsAgree: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  explanation: string;
}

const MAD_THRESHOLD = 3.5;
const Z_THRESHOLD = 3;

function severityFor(sigma: number, agree: number): AnomalyRecord['severity'] {
  const boosted = sigma + (agree - 1) * 0.4;
  if (boosted >= 6) return 'critical';
  if (boosted >= 4.5) return 'high';
  if (boosted >= 3.5) return 'medium';
  return 'low';
}

/** Detects anomalies for one dataset without persisting. */
export function detectAnomalies(ds: DatasetRow, opts: { maxPerDataset?: number } = {}): AnomalyRecord[] {
  const max = opts.maxPerDataset ?? 60;
  const metrics = metricColumns(ds.id);
  const dims = dimensionColumns(ds.id);
  const tcol = timeColumn(ds.id);
  const groupCol = dims[0]?.name ?? null;
  const labelCols = getColumns(ds.id)
    .filter((c) => c.semantic_role === 'dimension' || c.semantic_role === 'identifier')
    .slice(0, 2)
    .map((c) => c.name);
  const out: AnomalyRecord[] = [];
  const table = safeIdent(ds.table_name);

  for (const m of metrics) {
    const col = safeIdent(m.name);
    const rows = db
      .prepare(`SELECT row_id, ${col} AS v${groupCol ? `, ${safeIdent(groupCol)} AS g` : ''}${tcol ? `, ${safeIdent(tcol.name)} AS p` : ''}${labelCols.length ? `, ${labelCols.map((c) => `${safeIdent(c)} AS lbl_${safeIdent(c)}`).join(', ')}` : ''} FROM ${table} WHERE ${col} IS NOT NULL`)
      .all() as Record<string, string | number | null>[];
    if (rows.length < 12) continue;

    const groups = new Map<string, Record<string, string | number | null>[]>();
    for (const r of rows) {
      const key = groupCol ? String(r.g ?? 'ALL') : 'ALL';
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }

    for (const [gkey, grows] of groups) {
      if (grows.length < 10) continue;
      const vals = grows.map((r) => Number(r.v));
      const { median: med, scaled } = mad(vals);
      const mu = mean(vals);
      const sd = stddev(vals);
      const q1 = quantile(vals, 0.25);
      const q3 = quantile(vals, 0.75);
      const iqr = q3 - q1;
      const madSigmaDen = scaled > 0 ? scaled : sd > 0 ? sd : 1;
      for (let i = 0; i < grows.length; i++) {
        const v = vals[i];
        const sigmaMad = Math.abs(v - med) / madSigmaDen;
        const zs = sd > 0 ? Math.abs(v - mu) / sd : 0;
        const iqrOut = iqr > 0 && (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
        if (sigmaMad <= MAD_THRESHOLD) continue;
        const agree = 1 + (zs > Z_THRESHOLD ? 1 : 0) + (iqrOut ? 1 : 0);
        const low = round(med - MAD_THRESHOLD * madSigmaDen, 3);
        const high = round(med + MAD_THRESHOLD * madSigmaDen, 3);
        const deviation = round(v - med, 3);
        const label = labelCols
          .map((c) => grows[i][`lbl_${c}`])
          .filter((x) => x != null && x !== '')
          .join(' · ');
        out.push({
          datasetId: ds.id,
          datasetSlug: ds.slug,
          sourceRowId: Number(grows[i].row_id),
          column: m.name,
          entity: label || gkey,
          period: tcol ? String(grows[i].p ?? '') || null : null,
          value: round(v, 3),
          expectedLow: low,
          expectedHigh: high,
          deviation,
          sigma: round(sigmaMad, 2),
          method: 'MAD(primary)+z+IQR',
          methodsAgree: agree,
          severity: severityFor(sigmaMad, agree),
          score: round(sigmaMad * (1 + 0.15 * (agree - 1)), 3),
          explanation:
            `${m.name} = ${round(v, 2)} for ${label || gkey}` +
            (tcol && grows[i].p ? ` in ${grows[i].p}` : '') +
            `. Robust baseline (group '${gkey}', n=${grows.length}): median ${round(med, 2)}, scaled MAD ${round(madSigmaDen, 3)}` +
            `, so expected band ${low}..${high}. Deviation ${deviation} = ${round(sigmaMad, 2)}σ_MAD` +
            `; z-score ${round(zs, 2)} (${zs > Z_THRESHOLD ? 'flags' : 'does not flag'}), IQR rule ${iqrOut ? 'flags' : 'does not flag'}` +
            ` → ${agree}/3 detectors agree.`,
        });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

export function persistAnomalies(records: AnomalyRecord[]): number {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO anomalies(dataset_id, dataset_slug, source_row_id, column_name, entity, period, value,
      expected_low, expected_high, deviation, sigma, method, methods_agree, severity, score, explanation, status, detected_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
  );
  const tx = db.transaction((rs: AnomalyRecord[]) => {
    for (const r of rs) {
      insert.run(
        r.datasetId, r.datasetSlug, r.sourceRowId, r.column, r.entity, r.period, r.value,
        r.expectedLow, r.expectedHigh, r.deviation, r.sigma, r.method, r.methodsAgree, r.severity, r.score,
        r.explanation, now,
      );
    }
  });
  tx(records);
  return records.length;
}

/** Auto-run over every dataset. Used on boot (when empty) and by the live simulator. */
export function runAnomalyScan(opts: { datasetId?: number; replace?: boolean; maxPerDataset?: number } = {}): {
  datasets: number;
  detected: number;
  persisted: number;
  bySeverity: Record<string, number>;
} {
  const datasets = opts.datasetId ? listDatasets().filter((d) => d.id === opts.datasetId) : listDatasets();
  let detected = 0;
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const all: AnomalyRecord[] = [];
  for (const ds of datasets) {
    const recs = detectAnomalies(ds, { maxPerDataset: opts.maxPerDataset ?? 60 });
    detected += recs.length;
    for (const r of recs) bySeverity[r.severity]++;
    all.push(...recs);
  }
  if (opts.replace !== false) {
    const tx = db.transaction(() => {
      for (const ds of datasets) db.prepare('DELETE FROM anomalies WHERE dataset_id = ?').run(ds.id);
    });
    tx();
  }
  const persisted = persistAnomalies(all);
  appendAudit({
    actor: 'system@civicnexus.in',
    actorRole: 'system',
    action: 'ai.anomaly_scan',
    entity: opts.datasetId ? `dataset:${opts.datasetId}` : 'datasets:all',
    payload: { datasets: datasets.length, detected, persisted, bySeverity },
  });
  return { datasets: datasets.length, detected, persisted, bySeverity };
}

export function anomalyCount(): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM anomalies').get() as { n: number };
  return r.n;
}
