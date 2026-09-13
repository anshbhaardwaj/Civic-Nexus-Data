/**
 * AI-5 — Correlation & causality hints (SPEC §5).
 *
 * Pearson r, Spearman rho (average ranks), two-tailed t-test p-value
 *      t = r * sqrt((n-2) / (1 - r^2)),  p = I_{df/(df+t^2)}(df/2, 1/2)
 * Cross-correlation at lags 0..6 on the aggregated time series surfaces
 * leading indicators (best |r| at lag > 0).
 * Pairs with n < 30 are flagged as spurious-risk; correlation is never
 * presented as causation — only as a ranked hint with its evidence.
 */
import { DatasetRow, aggregateSeries, getRows, metricColumns, timeColumn } from '../lib/datasets';
import { ApiError } from '../lib/http';
import { corrPValue, pearson, round, spearman } from '../lib/stats';

export interface CorrelationResult {
  engine: 'AI-5';
  dataset: { id: number; slug: string; name: string };
  metrics: string[];
  n: number;
  matrix: { pearson: number[][]; spearman: number[][]; pValue: number[][] };
  pairs: {
    a: string;
    b: string;
    pearson: number;
    spearman: number;
    pValue: number;
    n: number;
    significant: boolean;
    strength: 'very strong' | 'strong' | 'moderate' | 'weak' | 'negligible';
    spurious: boolean;
    note: string;
  }[];
  leadingIndicators: {
    driver: string;
    target: string;
    bestLag: number;
    r: number;
    lagProfile: { lag: number; r: number; n: number }[];
    interpretation: string;
  }[];
  formulas: Record<string, string>;
  caveats: string[];
}

function strengthOf(r: number): CorrelationResult['pairs'][number]['strength'] {
  const a = Math.abs(r);
  if (a >= 0.85) return 'very strong';
  if (a >= 0.6) return 'strong';
  if (a >= 0.4) return 'moderate';
  if (a >= 0.2) return 'weak';
  return 'negligible';
}

export function runCorrelation(ds: DatasetRow, opts: { metrics?: string[]; maxLag?: number } = {}): CorrelationResult {
  const allMetrics = metricColumns(ds.id).map((c) => c.name);
  const metrics = (opts.metrics?.length ? opts.metrics.filter((m) => allMetrics.includes(m)) : allMetrics).slice(0, 10);
  if (metrics.length < 2) throw ApiError.notApplicable('Correlation needs at least 2 numeric metrics', { availableMetrics: allMetrics });

  const rows = getRows(ds, { columns: metrics });
  const cols: Record<string, number[]> = {};
  for (const m of metrics) cols[m] = [];
  let n = 0;
  for (const r of rows) {
    if (!metrics.every((m) => typeof r[m] === 'number' && Number.isFinite(r[m] as number))) continue;
    for (const m of metrics) cols[m].push(Number(r[m]));
    n++;
  }
  if (n < 3) throw ApiError.notApplicable('Not enough complete rows to compute correlations', { rows: n });

  const size = metrics.length;
  const mp: number[][] = [];
  const ms: number[][] = [];
  const mpv: number[][] = [];
  for (let i = 0; i < size; i++) {
    mp[i] = [];
    ms[i] = [];
    mpv[i] = [];
    for (let j = 0; j < size; j++) {
      const r = i === j ? 1 : pearson(cols[metrics[i]], cols[metrics[j]]);
      mp[i][j] = round(r, 4);
      ms[i][j] = i === j ? 1 : round(spearman(cols[metrics[i]], cols[metrics[j]]), 4);
      mpv[i][j] = i === j ? 0 : round(corrPValue(r, n), 6);
    }
  }

  const pairs: CorrelationResult['pairs'] = [];
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const r = mp[i][j];
      const p = mpv[i][j];
      const spurious = n < 30;
      pairs.push({
        a: metrics[i],
        b: metrics[j],
        pearson: r,
        spearman: ms[i][j],
        pValue: p,
        n,
        significant: p < 0.05 && !spurious,
        strength: strengthOf(r),
        spurious,
        note:
          `Pearson r=${r} (${strengthOf(r)} ${r >= 0 ? 'positive' : 'negative'}), Spearman rho=${ms[i][j]}, p=${p}, n=${n}. ` +
          (spurious
            ? 'n < 30 — flagged as spurious-risk, do not act on this pair alone.'
            : p < 0.05
              ? 'Statistically significant at alpha=0.05; association only, not proof of causation.'
              : 'Not significant at alpha=0.05.'),
      });
    }
  }
  pairs.sort((a, b) => Math.abs(b.pearson) - Math.abs(a.pearson));

  // cross-correlation for leading indicators
  const maxLag = Math.min(6, opts.maxLag ?? 6);
  const leading: CorrelationResult['leadingIndicators'] = [];
  const tcol = timeColumn(ds.id);
  if (tcol) {
    const seriesByMetric: Record<string, { periods: string[]; values: number[] }> = {};
    for (const m of metrics) {
      const s = aggregateSeries(ds, m, tcol.name, 'avg');
      seriesByMetric[m] = { periods: s.map((x) => x.period), values: s.map((x) => x.value) };
    }
    for (const target of metrics) {
      for (const driver of metrics) {
        if (driver === target) continue;
        const d = seriesByMetric[driver].values;
        const t = seriesByMetric[target].values;
        const len = Math.min(d.length, t.length);
        if (len < 12) continue;
        const profile: { lag: number; r: number; n: number }[] = [];
        for (let lag = 0; lag <= maxLag; lag++) {
          const dd = d.slice(0, len - lag);
          const tt = t.slice(lag, len);
          profile.push({ lag, r: round(pearson(dd, tt), 4), n: dd.length });
        }
        const best = profile.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
        if (best.lag > 0 && Math.abs(best.r) >= 0.5 && Math.abs(best.r) > Math.abs(profile[0].r) + 0.05) {
          leading.push({
            driver,
            target,
            bestLag: best.lag,
            r: best.r,
            lagProfile: profile,
            interpretation:
              `${driver} leads ${target} by ${best.lag} period(s): cross-correlation peaks at r=${best.r} vs r=${profile[0].r} at lag 0. ` +
              'Treat as a monitoring hint (Granger-style precedence), not established causality.',
          });
        }
      }
    }
    leading.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }

  return {
    engine: 'AI-5',
    dataset: { id: ds.id, slug: ds.slug, name: ds.name },
    metrics,
    n,
    matrix: { pearson: mp, spearman: ms, pValue: mpv },
    pairs,
    leadingIndicators: leading.slice(0, 10),
    formulas: {
      pearson: 'r = sum((x-mx)(y-my)) / sqrt(sum(x-mx)^2 * sum(y-my)^2)',
      spearman: 'rho = pearson(rank(x), rank(y)) with average ranks for ties',
      pValue: 't = r*sqrt((n-2)/(1-r^2)); p = I_{df/(df+t^2)}(df/2, 1/2) (two-tailed)',
      crossCorrelation: 'r(lag) = pearson(driver[0..n-lag], target[lag..n])',
    },
    caveats: [
      'Correlation is not causation. Leading indicators are precedence hints for monitoring only.',
      'Pairs with n < 30 are flagged spurious=true and excluded from significance claims.',
      'Aggregated series use the dataset time column with mean aggregation before lag analysis.',
    ],
  };
}
