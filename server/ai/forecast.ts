/**
 * AI-3 — Forecast ensemble (SPEC §5), hand-implemented.
 *
 * Candidate models
 *  1. naive-drift        : ŷ(T+h) = y(T) + h · (y(T)-y(1))/(T-1)
 *  2. Holt linear trend  : l(t)=α·y(t)+(1-α)(l(t-1)+b(t-1)); b(t)=β(l(t)-l(t-1))+(1-β)b(t-1)
 *                          grid-searched over α,β ∈ {0.1..0.9}
 *  3. seasonal-naive+drift: ŷ(T+h) = y(T+h-m) + h·drift, m = detected period
 * Selection: walk-forward (rolling-origin) validation, winner = lowest MAPE.
 * Intervals: ±z·σ(residuals)·√h with z=1.2816 (80%) and z=1.9600 (95%).
 */
import { DatasetRow, aggregateSeries, countRows, metricColumns, timeColumn } from '../lib/datasets';
import { ApiError } from '../lib/http';
import { mape, mean, round, stddev } from '../lib/stats';

export type ModelName = 'naive-drift' | 'holt-linear' | 'seasonal-naive-drift';

interface Fitted {
  model: ModelName;
  params: Record<string, number>;
  fitted: number[];
  forecast: (h: number) => number[];
  residualSd: number;
}

function naiveDrift(y: number[]): Fitted {
  const n = y.length;
  const drift = n > 1 ? (y[n - 1] - y[0]) / (n - 1) : 0;
  const fitted = y.map((_, i) => (i === 0 ? y[0] : y[i - 1] + drift));
  const resid = y.map((v, i) => v - fitted[i]).slice(1);
  return {
    model: 'naive-drift',
    params: { drift: round(drift, 4) },
    fitted,
    forecast: (h) => Array.from({ length: h }, (_, k) => y[n - 1] + (k + 1) * drift),
    residualSd: stddev(resid),
  };
}

function holt(y: number[], alpha: number, beta: number): Fitted {
  const n = y.length;
  let l = y[0];
  let b = n > 1 ? y[1] - y[0] : 0;
  const fitted: number[] = [y[0]];
  for (let t = 1; t < n; t++) {
    const f = l + b;
    fitted.push(f);
    const lPrev = l;
    l = alpha * y[t] + (1 - alpha) * (l + b);
    b = beta * (l - lPrev) + (1 - beta) * b;
  }
  const resid = y.map((v, i) => v - fitted[i]).slice(1);
  const lF = l;
  const bF = b;
  return {
    model: 'holt-linear',
    params: { alpha: round(alpha, 2), beta: round(beta, 2), level: round(lF, 4), trend: round(bF, 4) },
    fitted,
    forecast: (h) => Array.from({ length: h }, (_, k) => lF + (k + 1) * bF),
    residualSd: stddev(resid),
  };
}

function bestHolt(y: number[]): Fitted {
  let best: Fitted | null = null;
  let bestErr = Infinity;
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const f = holt(y, a / 10, b / 10);
      const err = mape(y.slice(1), f.fitted.slice(1));
      if (err < bestErr) {
        bestErr = err;
        best = f;
      }
    }
  }
  return best ?? holt(y, 0.3, 0.1);
}

function seasonalNaiveDrift(y: number[], m: number): Fitted {
  const n = y.length;
  const drift = n > m ? (y[n - 1] - y[n - 1 - m]) / m : 0;
  const fitted = y.map((v, i) => (i < m ? v : y[i - m] + drift));
  const resid = y.map((v, i) => v - fitted[i]).slice(m);
  return {
    model: 'seasonal-naive-drift',
    params: { period: m, drift: round(drift, 4) },
    fitted,
    forecast: (h) =>
      Array.from({ length: h }, (_, k) => {
        const idx = n + k - m;
        const base = idx >= 0 && idx < n ? y[idx] : y[n - 1];
        return base + (k + 1) * drift;
      }),
    residualSd: stddev(resid),
  };
}

/** Detects the dominant seasonal period by autocorrelation over 2..12 lags. */
export function detectPeriod(y: number[]): { period: number; acf: number } {
  const n = y.length;
  const mu = mean(y);
  const denom = y.reduce((a, v) => a + (v - mu) ** 2, 0) || 1;
  let best = { period: 1, acf: 0 };
  for (let lag = 2; lag <= Math.min(12, Math.floor(n / 3)); lag++) {
    let num = 0;
    for (let t = lag; t < n; t++) num += (y[t] - mu) * (y[t - lag] - mu);
    const acf = num / denom;
    if (acf > best.acf) best = { period: lag, acf };
  }
  return best.acf > 0.2 ? best : { period: 12, acf: round(best.acf, 3) };
}

function fitAll(y: number[], period: number): Fitted[] {
  const models: Fitted[] = [naiveDrift(y), bestHolt(y)];
  if (y.length > period + 3) models.push(seasonalNaiveDrift(y, period));
  return models;
}

export interface ForecastResult {
  engine: 'AI-3';
  dataset: { id: number; slug: string; name: string };
  metric: string;
  timeColumn: string;
  aggregation: 'sum' | 'avg';
  filter: { column: string; value: string } | null;
  history: { period: string; actual: number; fitted: number }[];
  horizon: number;
  seasonalPeriod: number;
  chosenModel: ModelName;
  chosenParams: Record<string, number>;
  selection: { model: ModelName; walkForwardMape: number; inSampleMape: number; folds: number }[];
  forecast: {
    step: number;
    period: string;
    value: number;
    lo80: number;
    hi80: number;
    lo95: number;
    hi95: number;
  }[];
  formulas: Record<string, string>;
  validation: { scheme: string; folds: number; minTrain: number };
}

function nextPeriods(periods: string[], h: number): string[] {
  const last = periods[periods.length - 1] ?? '';
  const mMatch = /^(\d{4})-(\d{2})(-(\d{2}))?$/.exec(last);
  const out: string[] = [];
  if (mMatch) {
    let year = Number(mMatch[1]);
    let month = Number(mMatch[2]);
    const day = mMatch[4];
    // financial-year style "2024-25": second part > 12
    if (month > 12) {
      for (let k = 1; k <= h; k++) {
        const y = year + k;
        out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
      }
      return out;
    }
    for (let k = 1; k <= h; k++) {
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
      out.push(`${year}-${String(month).padStart(2, '0')}${day ? `-${day}` : ''}`);
    }
    return out;
  }
  for (let k = 1; k <= h; k++) out.push(`T+${k}`);
  return out;
}

export interface ForecastOptions {
  metric?: string;
  horizon?: number;
  aggregation?: 'sum' | 'avg';
  filterColumn?: string;
  filterValue?: string;
}

export function runForecast(ds: DatasetRow, opts: ForecastOptions = {}): ForecastResult {
  const tcol = timeColumn(ds.id);
  if (!tcol) {
    throw ApiError.notApplicable(
      `Dataset '${ds.slug}' is cross-sectional (no time column), so a time-series forecast is not applicable.`,
      { hint: 'Use clustering or the isolation forest on this dataset instead.' },
    );
  }
  const metrics = metricColumns(ds.id).map((c) => c.name);
  const metric = opts.metric && metrics.includes(opts.metric) ? opts.metric : metrics[0];
  if (!metric) throw ApiError.notApplicable(`Dataset '${ds.slug}' has no numeric metric to forecast`, { metrics });
  const agg = opts.aggregation ?? 'sum';
  const filter = opts.filterColumn && opts.filterValue ? { column: opts.filterColumn, value: opts.filterValue } : undefined;
  const series = aggregateSeries(ds, metric, tcol.name, agg, filter);
  if (series.length < 8) {
    throw ApiError.notApplicable(
      `Only ${series.length} periods available for '${metric}'; at least 8 are needed for walk-forward validation.`,
      { periods: series.length },
    );
  }
  /**
   * Guard against cross-sectional tables whose date column is an event stamp
   * (e.g. bridge inspection dates): if nearly every row is its own period there
   * is no repeated observation per period, so a time series does not exist.
   */
  const rowsTotal = countRows(ds);
  if (rowsTotal > 0 && series.length / rowsTotal > 0.5) {
    throw ApiError.notApplicable(
      `Dataset '${ds.slug}' is cross-sectional: '${tcol.name}' is an event date with ${series.length} distinct values across ${rowsTotal} rows ` +
        `(${Math.round((series.length / rowsTotal) * 100)}%), so there is no repeated period to forecast.`,
      { distinctPeriods: series.length, rows: rowsTotal, hint: 'Use /api/ai/isolation-forest or /api/ai/clusters on this dataset.' },
    );
  }
  const y = series.map((s) => s.value);
  const periods = series.map((s) => s.period);
  const horizon = Math.min(5, Math.max(1, opts.horizon ?? 5));
  const { period: seasonalPeriod } = detectPeriod(y);

  // walk-forward (rolling origin) validation
  const minTrain = Math.max(6, Math.floor(y.length * 0.6));
  const errsByModel = new Map<ModelName, number[]>();
  let folds = 0;
  for (let cut = minTrain; cut < y.length; cut++) {
    const train = y.slice(0, cut);
    const actual = [y[cut]];
    folds++;
    for (const f of fitAll(train, seasonalPeriod)) {
      const pred = f.forecast(1);
      const e = mape(actual, pred);
      const list = errsByModel.get(f.model) ?? [];
      if (Number.isFinite(e)) list.push(e);
      errsByModel.set(f.model, list);
    }
  }
  const finalFits = fitAll(y, seasonalPeriod);
  const selection = finalFits.map((f) => {
    const errs = errsByModel.get(f.model) ?? [];
    return {
      model: f.model,
      walkForwardMape: errs.length ? round(mean(errs), 3) : Number.POSITIVE_INFINITY,
      inSampleMape: round(mape(y.slice(1), f.fitted.slice(1)), 3),
      folds: errs.length,
    };
  });
  const winnerName = selection.reduce((a, b) => (b.walkForwardMape < a.walkForwardMape ? b : a)).model;
  const winner = finalFits.find((f) => f.model === winnerName)!;

  const preds = winner.forecast(horizon);
  const sd = winner.residualSd || Math.abs(mean(y)) * 0.05 || 1;
  const outPeriods = nextPeriods(periods, horizon);

  return {
    engine: 'AI-3',
    dataset: { id: ds.id, slug: ds.slug, name: ds.name },
    metric,
    timeColumn: tcol.name,
    aggregation: agg,
    filter: filter ?? null,
    history: series.map((s, i) => ({ period: s.period, actual: round(s.value, 3), fitted: round(winner.fitted[i], 3) })),
    horizon,
    seasonalPeriod,
    chosenModel: winner.model,
    chosenParams: winner.params,
    selection: selection.sort((a, b) => a.walkForwardMape - b.walkForwardMape),
    forecast: preds.map((v, k) => {
      const spread = sd * Math.sqrt(k + 1);
      return {
        step: k + 1,
        period: outPeriods[k],
        value: round(v, 3),
        lo80: round(v - 1.2816 * spread, 3),
        hi80: round(v + 1.2816 * spread, 3),
        lo95: round(v - 1.96 * spread, 3),
        hi95: round(v + 1.96 * spread, 3),
      };
    }),
    formulas: {
      'naive-drift': 'yhat(T+h) = y(T) + h * (y(T) - y(1)) / (T - 1)',
      'holt-linear': 'l(t)=a*y(t)+(1-a)(l(t-1)+b(t-1)); b(t)=B(l(t)-l(t-1))+(1-B)b(t-1); yhat(T+h)=l(T)+h*b(T)',
      'seasonal-naive-drift': 'yhat(T+h) = y(T+h-m) + h * (y(T)-y(T-m))/m',
      interval: 'yhat +/- z * sd(residuals) * sqrt(h), z = 1.2816 (80%), 1.96 (95%)',
      selection: 'argmin over models of mean rolling-origin MAPE',
    },
    validation: { scheme: 'rolling-origin walk-forward, 1-step-ahead', folds, minTrain },
  };
}
