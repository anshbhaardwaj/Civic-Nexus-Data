/**
 * AI-8 — Offline NLP -> NLG, "Ask CivicData" (SPEC §5).
 *
 * Pipeline: tokenise -> intent classification (rank / compare / trend /
 * anomaly / correlate / total) -> entity resolution against the real column and
 * dimension vocabularies built from SQLite -> execute the matching engine ->
 * template NLG answer with the actual numbers. The resolved interpretation is
 * always returned so the user can see exactly what was understood.
 *
 * No language model, no network: scoring is keyword + token-overlap based.
 */
import { db, safeIdent } from '../db';
import {
  DatasetRow,
  aggregateByDimension,
  aggregateSeries,
  distinctValues,
  getColumns,
  listDatasets,
  timeColumn,
} from '../lib/datasets';
import { ApiError } from '../lib/http';
import { round } from '../lib/stats';
import { runCorrelation } from './correlation';
import { runForecast } from './forecast';

export type Intent = 'rank' | 'compare' | 'trend' | 'anomaly' | 'correlate' | 'total';

const INTENT_KEYWORDS: Record<Intent, string[]> = {
  rank: ['top', 'worst', 'best', 'rank', 'ranking', 'highest', 'lowest', 'most', 'least', 'leaderboard', 'which district', 'which city'],
  compare: ['compare', 'versus', 'vs', 'against', 'difference between', 'better than'],
  trend: ['trend', 'forecast', 'project', 'projection', 'next', 'future', 'over time', 'growth', 'predict', 'outlook'],
  anomaly: ['anomaly', 'anomalies', 'outlier', 'outliers', 'unusual', 'spike', 'suspicious', 'irregular', 'flag'],
  correlate: ['correlate', 'correlation', 'relationship', 'related', 'associated', 'linked', 'drive', 'driver', 'leading indicator'],
  total: ['total', 'sum', 'overall', 'how much', 'how many', 'aggregate', 'altogether'],
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'is', 'are', 'was', 'were', 'by', 'with', 'what', 'which',
  'show', 'me', 'give', 'please', 'do', 'does', 'did', 'my', 'our', 'from', 'at', 'as', 'be', 'per', 'across', 'has',
  'have', 'had', 'over', 'about', 'india', 'indian', 'government', 'please',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%₹.\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0);
}

export function classifyIntent(question: string, tokens: string[]): { intent: Intent; scores: Record<Intent, number>; matched: string[] } {
  const q = question.toLowerCase();
  const scores = { rank: 0, compare: 0, trend: 0, anomaly: 0, correlate: 0, total: 0 } as Record<Intent, number>;
  const matched: string[] = [];
  for (const [intent, words] of Object.entries(INTENT_KEYWORDS) as [Intent, string[]][]) {
    for (const w of words) {
      if (w.includes(' ') ? q.includes(w) : tokens.includes(w)) {
        scores[intent] += w.includes(' ') ? 2 : 1;
        matched.push(`${intent}:${w}`);
      }
    }
  }
  if (/\bvs\b|\bversus\b/.test(q)) scores.compare += 2;
  let intent: Intent = 'rank';
  let best = -1;
  for (const [k, v] of Object.entries(scores) as [Intent, number][]) {
    if (v > best) {
      best = v;
      intent = k;
    }
  }
  if (best === 0) intent = 'total';
  return { intent, scores, matched };
}

interface Vocab {
  metrics: { dataset: DatasetRow; column: string; words: string[] }[];
  dimensions: { dataset: DatasetRow; column: string; values: string[] }[];
}

let vocabCache: { key: string; vocab: Vocab } | null = null;

export function buildVocabulary(): Vocab {
  const datasets = listDatasets();
  const key = datasets.map((d) => `${d.id}:${d.row_count}`).join('|');
  if (vocabCache && vocabCache.key === key) return vocabCache.vocab;
  const vocab: Vocab = { metrics: [], dimensions: [] };
  for (const ds of datasets) {
    for (const c of getColumns(ds.id)) {
      if (c.semantic_role === 'metric') {
        vocab.metrics.push({ dataset: ds, column: c.name, words: c.name.split('_') });
      } else if (c.semantic_role === 'dimension' && c.distinct_count <= 400) {
        vocab.dimensions.push({ dataset: ds, column: c.name, values: distinctValues(ds, c.name, 400) });
      }
    }
  }
  vocabCache = { key, vocab };
  return vocab;
}

function metricScore(tokens: string[], words: string[]): number {
  let hits = 0;
  for (const w of words) {
    if (w.length < 3) continue;
    if (tokens.some((t) => t === w || t.startsWith(w) || w.startsWith(t))) hits++;
  }
  return hits / Math.max(1, words.filter((w) => w.length >= 3).length);
}

export interface AskResolution {
  intent: Intent;
  intentScores: Record<Intent, number>;
  matchedKeywords: string[];
  tokens: string[];
  dataset: { id: number; slug: string; name: string } | null;
  metric: string | null;
  secondMetric: string | null;
  dimension: string | null;
  entities: { column: string; value: string }[];
  topN: number;
  direction: 'desc' | 'asc';
  unresolved: string[];
}

export interface AskResult {
  engine: 'AI-8';
  question: string;
  answer: string;
  interpretation: AskResolution;
  data: unknown;
  engineUsed: string;
  formula: string;
  confidence: number;
}

function resolve(question: string, tokens: string[], intent: Intent, intentScores: Record<Intent, number>, matched: string[]): AskResolution {
  const vocab = buildVocabulary();
  const q = question.toLowerCase();

  // 1. entity (dimension value) resolution
  const entities: { column: string; value: string; dataset: DatasetRow }[] = [];
  for (const d of vocab.dimensions) {
    for (const val of d.values) {
      const v = val.toLowerCase();
      if (v.length < 3) continue;
      if (q.includes(v)) entities.push({ column: d.column, value: val, dataset: d.dataset });
    }
  }
  // 2. metric resolution
  const metricScores = vocab.metrics
    .map((m) => ({ ...m, score: metricScore(tokens, m.words) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  // 3. dataset resolution: prefer dataset implied by metric, else by entity, else keyword on slug
  let dataset: DatasetRow | null = metricScores[0]?.dataset ?? entities[0]?.dataset ?? null;
  if (!dataset) {
    const datasets = listDatasets();
    dataset =
      datasets.find((d) => d.slug.split('_').some((w) => tokens.includes(w))) ??
      datasets.find((d) => tokens.some((t) => d.name.toLowerCase().includes(t) && t.length > 4)) ??
      datasets[0] ??
      null;
  }
  if (!dataset) throw ApiError.notFound('No datasets available to answer questions against');

  const cols = getColumns(dataset.id);
  const dsMetrics = metricScores.filter((m) => m.dataset.id === dataset!.id);
  const metric = dsMetrics[0]?.column ?? cols.find((c) => c.semantic_role === 'metric')?.name ?? null;
  const secondMetric = dsMetrics[1]?.column ?? cols.filter((c) => c.semantic_role === 'metric')[1]?.name ?? null;

  // 4. dimension resolution (grouping unit)
  const dimCandidates = cols.filter((c) => c.semantic_role === 'dimension');
  let dimension =
    dimCandidates.find((c) => tokens.some((t) => c.name.includes(t) && t.length > 3))?.name ??
    entities.find((e) => e.dataset.id === dataset!.id)?.column ??
    dimCandidates[0]?.name ??
    null;
  if (/district/.test(q) && dimCandidates.some((c) => c.name === 'district')) dimension = 'district';
  if (/city|cities/.test(q) && dimCandidates.some((c) => c.name === 'city')) dimension = 'city';
  if (/department|dept/.test(q) && dimCandidates.some((c) => c.name === 'department')) dimension = 'department';
  if (/scheme/.test(q) && dimCandidates.some((c) => c.name === 'scheme')) dimension = 'scheme';
  if (/state/.test(q) && dimCandidates.some((c) => c.name === 'state')) dimension = 'state';

  const nMatch = /\btop\s+(\d{1,2})\b|\b(\d{1,2})\s+(worst|best|highest|lowest)\b/.exec(q);
  const topN = nMatch ? Number(nMatch[1] ?? nMatch[2]) : 5;
  const ascWords = ['lowest', 'least', 'worst utilisation', 'slowest', 'bottom', 'weakest', 'under', 'lagging'];
  const direction: 'desc' | 'asc' =
    ascWords.some((w) => q.includes(w)) || /\blowest\b/.test(q) ? 'asc' : 'desc';

  const knownTokens = new Set<string>();
  for (const m of dsMetrics) for (const w of m.words) knownTokens.add(w);
  for (const e of entities) for (const w of e.value.toLowerCase().split(/\s+/)) knownTokens.add(w);
  const intentWords = new Set(Object.values(INTENT_KEYWORDS).flat().flatMap((w) => w.split(' ')));
  const unresolved = tokens.filter(
    (t) => !STOPWORDS.has(t) && !intentWords.has(t) && t.length > 3 && !knownTokens.has(t) && !/^\d+$/.test(t),
  );

  return {
    intent,
    intentScores,
    matchedKeywords: matched,
    tokens,
    dataset: { id: dataset.id, slug: dataset.slug, name: dataset.name },
    metric,
    secondMetric,
    dimension,
    entities: entities.filter((e) => e.dataset.id === dataset!.id).map((e) => ({ column: e.column, value: e.value })),
    topN: Math.min(20, Math.max(2, topN)),
    direction,
    unresolved: Array.from(new Set(unresolved)).slice(0, 8),
  };
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Executes the natural-language question end to end. */
export function ask(question: string): AskResult {
  if (!question.trim()) throw ApiError.validation('Question must not be empty');
  const tokens = tokenise(question);
  const { intent, scores, matched } = classifyIntent(question, tokens);
  const res = resolve(question, tokens, intent, scores, matched);
  const dsRow = listDatasets().find((d) => d.id === res.dataset!.id)!;
  const confidenceBase = Math.min(1, 0.55 + 0.1 * (scores[intent] || 0) + (res.metric ? 0.15 : 0) + (res.entities.length ? 0.1 : 0));

  switch (res.intent) {
    case 'rank': {
      if (!res.metric || !res.dimension) throw ApiError.notApplicable('Could not resolve a metric and a grouping dimension for a ranking question', { interpretation: res });
      const agg = /total|sum|spent|allocation|released|beneficiaries|calls|incidents/.test(res.metric) ? 'sum' : 'avg';
      const groups = aggregateByDimension(dsRow, res.dimension, [res.metric], agg);
      const sorted = groups
        .map((g) => ({ key: g.key, value: round(g.values[res.metric!], 2), n: g.n }))
        .sort((a, b) => (res.direction === 'desc' ? b.value - a.value : a.value - b.value))
        .slice(0, res.topN);
      const answer =
        `Ranking ${res.dimension.replace(/_/g, ' ')}s by ${agg}(${res.metric.replace(/_/g, ' ')}) in '${dsRow.name}' ` +
        `(${res.direction === 'desc' ? 'highest' : 'lowest'} first): ` +
        sorted.map((s, i) => `${i + 1}. ${s.key} — ${fmt(s.value)}`).join('; ') +
        `. Computed over ${groups.length} groups and ${dsRow.row_count} ingested rows.`;
      return {
        engine: 'AI-8', question, answer, interpretation: res,
        data: { rows: sorted, aggregation: agg, groups: groups.length },
        engineUsed: 'SQL group-by aggregation over ds_' + dsRow.slug,
        formula: `${agg}(${res.metric}) GROUP BY ${res.dimension} ORDER BY value ${res.direction.toUpperCase()} LIMIT ${res.topN}`,
        confidence: round(confidenceBase, 2),
      };
    }
    case 'compare': {
      if (!res.metric || !res.dimension) throw ApiError.notApplicable('Comparison needs a metric and a dimension', { interpretation: res });
      const agg = /total|sum|spent|allocation|released|beneficiaries|calls|incidents/.test(res.metric) ? 'sum' : 'avg';
      const groups = aggregateByDimension(dsRow, res.dimension, [res.metric], agg);
      const named = res.entities.length >= 1 ? res.entities.map((e) => e.value) : groups.slice(0, 2).map((g) => g.key);
      const picked = named
        .map((name) => groups.find((g) => g.key.toLowerCase() === name.toLowerCase()))
        .filter((g): g is NonNullable<typeof g> => !!g)
        .slice(0, 4);
      if (picked.length < 2) {
        const fallback = groups.slice(0, 2);
        picked.push(...fallback.filter((f) => !picked.includes(f)).slice(0, 2 - picked.length));
      }
      const values = picked.map((p) => ({ key: p.key, value: round(p.values[res.metric!], 2) }));
      const diff = round(values[0].value - values[1].value, 2);
      const pct = values[1].value !== 0 ? round((diff / Math.abs(values[1].value)) * 100, 1) : 0;
      const answer =
        `${values[0].key} records ${agg}(${res.metric.replace(/_/g, ' ')}) = ${fmt(values[0].value)} versus ` +
        `${fmt(values[1].value)} for ${values[1].key} — a gap of ${fmt(diff)} (${pct >= 0 ? '+' : ''}${pct}%). ` +
        (values.length > 2 ? `Also compared: ${values.slice(2).map((v) => `${v.key} ${fmt(v.value)}`).join(', ')}. ` : '') +
        `Source: '${dsRow.name}', ${dsRow.row_count} rows.`;
      return {
        engine: 'AI-8', question, answer, interpretation: res,
        data: { values, differenceAbs: diff, differencePct: pct, aggregation: agg },
        engineUsed: 'SQL group-by comparison',
        formula: `${agg}(${res.metric}) for each requested ${res.dimension}; gap = A - B; gap% = 100 x (A-B)/|B|`,
        confidence: round(confidenceBase, 2),
      };
    }
    case 'trend': {
      const filter = res.entities[0];
      const f = runForecast(dsRow, {
        metric: res.metric ?? undefined,
        horizon: 5,
        aggregation: /total|sum|spent|allocation|released|beneficiaries|calls|incidents/.test(res.metric ?? '') ? 'sum' : 'avg',
        filterColumn: filter?.column,
        filterValue: filter?.value,
      });
      const first = f.history[0];
      const last = f.history[f.history.length - 1];
      const chg = last.actual - first.actual;
      const answer =
        `${f.metric.replace(/_/g, ' ')} in '${dsRow.name}'${filter ? ` for ${filter.value}` : ''} moved from ${fmt(first.actual)} (${first.period}) ` +
        `to ${fmt(last.actual)} (${last.period}), a change of ${fmt(round(chg, 2))} ` +
        `(${first.actual !== 0 ? round((chg / Math.abs(first.actual)) * 100, 1) : 0}%). ` +
        `The ${f.chosenModel} model won walk-forward validation (MAPE ${f.selection[0].walkForwardMape}%) and projects ` +
        `${fmt(f.forecast[f.forecast.length - 1].value)} by ${f.forecast[f.forecast.length - 1].period} ` +
        `(95% interval ${fmt(f.forecast[f.forecast.length - 1].lo95)} to ${fmt(f.forecast[f.forecast.length - 1].hi95)}).`;
      return {
        engine: 'AI-8', question, answer, interpretation: res, data: f,
        engineUsed: 'AI-3 forecast ensemble',
        formula: f.formulas[f.chosenModel] ?? 'ensemble selection by rolling-origin MAPE',
        confidence: round(confidenceBase, 2),
      };
    }
    case 'anomaly': {
      const params: unknown[] = [dsRow.id];
      let sql = 'SELECT * FROM anomalies WHERE dataset_id = ?';
      if (res.entities.length) {
        sql += ' AND (' + res.entities.map(() => 'entity LIKE ?').join(' OR ') + ')';
        for (const e of res.entities) params.push(`%${e.value}%`);
      }
      if (res.metric && /anomal|outlier|spike/.test(question.toLowerCase()) === false) {
        sql += ' AND column_name = ?';
        params.push(res.metric);
      }
      sql += ' ORDER BY score DESC LIMIT ?';
      params.push(res.topN);
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      const total = (db.prepare('SELECT COUNT(*) AS n FROM anomalies WHERE dataset_id = ?').get(dsRow.id) as { n: number }).n;
      const answer = rows.length
        ? `${total} open/reviewed anomalies are recorded for '${dsRow.name}'. The strongest ${rows.length}: ` +
          rows
            .map(
              (r) =>
                `${r.column_name} = ${fmt(Number(r.value))} at ${r.entity}${r.period ? ` (${r.period})` : ''} — ${Number(r.sigma)}σ from the robust baseline, severity ${r.severity}`,
            )
            .join('; ') +
          `. Detection: MAD primary with z-score and IQR corroboration (AI-1).`
        : `No anomalies are currently recorded for '${dsRow.name}'. Run POST /api/ai/anomalies/scan to re-scan.`;
      return {
        engine: 'AI-8', question, answer, interpretation: res,
        data: { total, anomalies: rows },
        engineUsed: 'AI-1 statistical anomaly engine (persisted results)',
        formula: 'sigma_MAD = |x - median| / (1.4826 x MAD); flag when > 3.5',
        confidence: round(confidenceBase, 2),
      };
    }
    case 'correlate': {
      const c = runCorrelation(dsRow);
      const top = c.pairs[0];
      const lead = c.leadingIndicators[0];
      const answer =
        `In '${dsRow.name}' the strongest association is ${top.a.replace(/_/g, ' ')} vs ${top.b.replace(/_/g, ' ')}: ` +
        `Pearson r = ${top.pearson} (Spearman ${top.spearman}, p = ${top.pValue}, n = ${top.n}) — ${top.strength} ` +
        `${top.pearson >= 0 ? 'positive' : 'negative'} and ${top.significant ? 'statistically significant' : 'not significant'} at α = 0.05. ` +
        (lead
          ? `Cross-correlation suggests ${lead.driver.replace(/_/g, ' ')} leads ${lead.target.replace(/_/g, ' ')} by ${lead.bestLag} period(s) (r = ${lead.r}). `
          : 'No leading indicator passed the lag test (|r| ≥ 0.5 and better than lag 0). ') +
        'Association is not causation.';
      return {
        engine: 'AI-8', question, answer, interpretation: res, data: c,
        engineUsed: 'AI-5 correlation & causality hints',
        formula: c.formulas.pearson,
        confidence: round(confidenceBase, 2),
      };
    }
    case 'total':
    default: {
      if (!res.metric) throw ApiError.notApplicable('Could not resolve a numeric metric to total', { interpretation: res });
      const col = safeIdent(res.metric);
      const table = safeIdent(dsRow.table_name);
      let sql = `SELECT SUM(${col}) AS total, AVG(${col}) AS avg, MIN(${col}) AS min, MAX(${col}) AS max, COUNT(${col}) AS n FROM ${table}`;
      const params: unknown[] = [];
      if (res.entities.length) {
        sql += ' WHERE ' + res.entities.map((e) => `${safeIdent(e.column)} = ?`).join(' AND ');
        for (const e of res.entities) params.push(e.value);
      }
      const agg = db.prepare(sql).get(...params) as { total: number; avg: number; min: number; max: number; n: number };
      const tcol = timeColumn(dsRow.id);
      const series = tcol ? aggregateSeries(dsRow, res.metric, tcol.name, 'sum') : [];
      const money = /_cr$/.test(res.metric);
      const answer =
        `${money ? '₹' : ''}${fmt(round(agg.total ?? 0, 2))}${money ? ' crore' : ''} is the total ${res.metric.replace(/_/g, ' ')} ` +
        `in '${dsRow.name}'${res.entities.length ? ` filtered to ${res.entities.map((e) => `${e.column}=${e.value}`).join(', ')}` : ''} ` +
        `across ${fmt(agg.n ?? 0)} rows (mean ${fmt(round(agg.avg ?? 0, 2))}, min ${fmt(round(agg.min ?? 0, 2))}, max ${fmt(round(agg.max ?? 0, 2))}).`;
      return {
        engine: 'AI-8', question, answer, interpretation: res,
        data: { total: round(agg.total ?? 0, 2), mean: round(agg.avg ?? 0, 3), min: agg.min, max: agg.max, rows: agg.n, series },
        engineUsed: 'SQL aggregate',
        formula: `SUM(${res.metric})${res.entities.length ? ' filtered by resolved dimension values' : ''}`,
        confidence: round(confidenceBase, 2),
      };
    }
  }
}

/** 10 worked examples that all return non-empty results (SPEC §5, AI-8). */
export const EXAMPLE_QUESTIONS: string[] = [
  'Top 5 districts by total spent_cr in scheme expenditure',
  'Which districts have the lowest utilisation_pct?',
  'Compare Pune versus Nagpur bed occupancy',
  'Show the trend of avg_response_min for ambulances',
  'Forecast aqi for the next 5 months',
  'What anomalies were found in hospital capacity?',
  'Show outliers in scheme expenditure',
  'Correlation between pm25 and vehicles_registered',
  'What is the relationship between congestion_index and avg_speed_kmph?',
  'Total released_cr across all schemes',
];

export function runExamples(): { question: string; ok: boolean; answer: string; error?: string }[] {
  return EXAMPLE_QUESTIONS.map((q) => {
    try {
      const r = ask(q);
      return { question: q, ok: Boolean(r.answer), answer: r.answer };
    } catch (e) {
      return { question: q, ok: false, answer: '', error: e instanceof Error ? e.message : String(e) };
    }
  });
}
