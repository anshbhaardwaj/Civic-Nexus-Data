/** /api/ai/* — the 8 engines. */
import { Router } from 'express';
import { z } from 'zod';
import { detectAnomalies, runAnomalyScan } from '../ai/anomaly';
import { EXAMPLE_QUESTIONS, ask, runExamples } from '../ai/ask';
import { runClustering } from '../ai/cluster';
import { runCorrelation } from '../ai/correlation';
import { runForecast } from '../ai/forecast';
import { CRITERION_WEIGHTS, listPolicyCards, refreshPolicyCards, totalIdleCapitalCr } from '../ai/mcda';
import { runIsolationForest } from '../ai/iforest';
import { runOptimiser } from '../ai/optimiser';
import { listDatasets, mustDataset, resolveDatasetForColumn } from '../lib/datasets';
import { asyncHandler, audit, requireAuth, requirePermission, v, validate } from '../lib/http';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const dsQuery = z.object({ dataset: z.string().min(1).optional() });

function pickDataset(ref?: string) {
  return ref ? mustDataset(ref) : resolveDatasetForColumn(undefined);
}

/* ------------------------------------------------------------- registry */

aiRouter.get(
  '/engines',
  requirePermission('policy.read'),
  asyncHandler((_req, res) => {
    const datasets = listDatasets().map((d) => ({ id: d.id, slug: d.slug, name: d.name, rows: d.row_count }));
    res.json({
      engines: [
        { id: 'AI-1', name: 'Statistical anomaly engine', route: 'GET /api/ai/anomalies', method: 'MAD primary (3.5σ) + z-score + IQR agreement', output: 'anomalies with expected band, deviation, source row id', permission: 'anomalies.read' },
        { id: 'AI-2', name: 'Isolation forest', route: 'GET /api/ai/isolation-forest', method: '100 iTrees, ψ=256, path-length scoring, ablation attribution', output: 'anomaly scores, thresholdUsed, per-feature contributions', permission: 'ai.run' },
        { id: 'AI-3', name: 'Forecast ensemble', route: 'GET /api/ai/forecast', method: 'naive-drift, Holt linear, seasonal-naive+drift; walk-forward MAPE selection', output: 'fitted history, 1-5 step forecast, 80/95% intervals', permission: 'ai.run' },
        { id: 'AI-4', name: 'Clustering', route: 'GET /api/ai/clusters', method: 'k-means++ on z-scores, k by silhouette over 2..8', output: 'centroids, per-cluster profile, silhouette per point, labels', permission: 'ai.run' },
        { id: 'AI-5', name: 'Correlation & causality hints', route: 'GET /api/ai/correlation', method: 'Pearson + Spearman with t-test p-values, cross-correlation lags 0..6', output: 'matrix, ranked pairs, leading indicators', permission: 'ai.run' },
        { id: 'AI-6', name: 'MCDA policy cards', route: 'GET /api/ai/policy-cards', method: 'weighted sum of 6 normalised criteria', output: '0-100 impact score with reconciling contribution breakdown', permission: 'policy.read' },
        { id: 'AI-7', name: 'Fund optimiser', route: 'GET /api/ai/optimise', method: '0/1 knapsack dynamic programming + budget sweep', output: 'portfolio, utilisation, Pareto frontier', permission: 'funds.optimise' },
        { id: 'AI-8', name: 'Ask CivicData (NLP → NLG)', route: 'POST /api/ai/ask', method: 'tokenise → intent → entity resolution → engine execution → template NLG', output: 'answer text, resolved interpretation, engine payload', permission: 'ask.run' },
      ],
      datasets,
      mcdaWeights: CRITERION_WEIGHTS,
      idleCapitalCr: totalIdleCapitalCr(),
      offline: true,
    });
  }),
);

/* ------------------------------------------------------------------ AI-1 */

aiRouter.get(
  '/anomalies',
  requirePermission('anomalies.read'),
  validate({ query: dsQuery.extend({ limit: z.coerce.number().int().min(1).max(200).default(50) }) }),
  asyncHandler((req, res) => {
    const q = v<{ dataset?: string; limit: number }>(req, 'query');
    const ds = pickDataset(q.dataset);
    const records = detectAnomalies(ds, { maxPerDataset: q.limit });
    res.json({
      engine: 'AI-1',
      dataset: { id: ds.id, slug: ds.slug, name: ds.name },
      method: {
        primary: 'sigma_MAD = |x - median| / (1.4826 x MAD), flag > 3.5',
        corroborating: ['z = |x - mean| / stddev > 3', 'x outside [Q1 - 1.5·IQR, Q3 + 1.5·IQR]'],
        severity: 'critical ≥ 6σ, high ≥ 4.5σ, medium ≥ 3.5σ (agreement adds 0.4σ per extra detector)',
        baseline: 'per dimension group when available, else global',
      },
      count: records.length,
      anomalies: records,
    });
  }),
);

aiRouter.post(
  '/anomalies/scan',
  requirePermission('ai.run'),
  validate({ body: z.object({ dataset: z.string().optional() }).default({}) }),
  asyncHandler((req, res) => {
    const body = v<{ dataset?: string }>(req, 'body');
    const ds = body.dataset ? mustDataset(body.dataset) : undefined;
    const result = runAnomalyScan({ datasetId: ds?.id, replace: true });
    audit(req, 'ai.anomaly_scan', ds ? `dataset:${ds.slug}` : 'datasets:all', result);
    res.json({ engine: 'AI-1', ...result });
  }),
);

/* ------------------------------------------------------------------ AI-2 */

aiRouter.get(
  '/isolation-forest',
  requirePermission('ai.run'),
  validate({
    query: dsQuery.extend({
      trees: z.coerce.number().int().min(10).max(300).default(100),
      psi: z.coerce.number().int().min(32).max(1024).default(256),
      topN: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  asyncHandler((req, res) => {
    const q = v<{ dataset?: string; trees: number; psi: number; topN: number }>(req, 'query');
    const ds = pickDataset(q.dataset);
    res.json(runIsolationForest(ds, { trees: q.trees, psi: q.psi, topN: q.topN }));
  }),
);

/* ------------------------------------------------------------------ AI-3 */

aiRouter.get(
  '/forecast',
  requirePermission('ai.run'),
  validate({
    query: dsQuery.extend({
      metric: z.string().max(64).optional(),
      horizon: z.coerce.number().int().min(1).max(5).default(5),
      aggregation: z.enum(['sum', 'avg']).default('sum'),
      filterColumn: z.string().max(64).optional(),
      filterValue: z.string().max(120).optional(),
    }),
  }),
  asyncHandler((req, res) => {
    const q = v<{ dataset?: string; metric?: string; horizon: number; aggregation: 'sum' | 'avg'; filterColumn?: string; filterValue?: string }>(req, 'query');
    const ds = q.dataset ? mustDataset(q.dataset) : resolveDatasetForColumn(undefined, q.metric);
    res.json(runForecast(ds, { metric: q.metric, horizon: q.horizon, aggregation: q.aggregation, filterColumn: q.filterColumn, filterValue: q.filterValue }));
  }),
);

/* ------------------------------------------------------------------ AI-4 */

aiRouter.get(
  '/clusters',
  requirePermission('ai.run'),
  validate({
    query: dsQuery.extend({
      dimension: z.string().max(64).optional(),
      k: z.coerce.number().int().min(2).max(8).optional(),
      aggregation: z.enum(['sum', 'avg']).default('avg'),
    }),
  }),
  asyncHandler((req, res) => {
    const q = v<{ dataset?: string; dimension?: string; k?: number; aggregation: 'sum' | 'avg' }>(req, 'query');
    const ds = pickDataset(q.dataset);
    res.json(runClustering(ds, { dimension: q.dimension, k: q.k, aggregation: q.aggregation }));
  }),
);

/* ------------------------------------------------------------------ AI-5 */

aiRouter.get(
  '/correlation',
  requirePermission('ai.run'),
  validate({ query: dsQuery.extend({ maxLag: z.coerce.number().int().min(1).max(6).default(6) }) }),
  asyncHandler((req, res) => {
    const q = v<{ dataset?: string; maxLag: number }>(req, 'query');
    const ds = pickDataset(q.dataset);
    res.json(runCorrelation(ds, { maxLag: q.maxLag }));
  }),
);

/* ------------------------------------------------------------------ AI-6 */

aiRouter.get(
  '/policy-cards',
  requirePermission('policy.read'),
  validate({ query: z.object({ sector: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }) }),
  asyncHandler((req, res) => {
    const q = v<{ sector?: string; limit: number }>(req, 'query');
    let cards = listPolicyCards();
    if (!cards.length) cards = refreshPolicyCards();
    if (q.sector) cards = cards.filter((c) => c.sector.toLowerCase() === q.sector!.toLowerCase());
    res.json({
      engine: 'AI-6',
      weights: CRITERION_WEIGHTS,
      formula: 'impact = 100 x sum(weight_i x normalised_i); contributions reconcile exactly to the total',
      count: cards.length,
      cards: cards.slice(0, q.limit),
      sectors: Array.from(new Set(listPolicyCards().map((c) => c.sector))),
    });
  }),
);

aiRouter.post(
  '/policy-cards/refresh',
  requirePermission('ai.run'),
  asyncHandler((req, res) => {
    const cards = refreshPolicyCards(req.user!.email, req.user!.role);
    audit(req, 'ai.policy_cards_refresh', 'policy_cards', { count: cards.length });
    res.json({ engine: 'AI-6', count: cards.length, cards });
  }),
);

/* ------------------------------------------------------------------ AI-7 */

aiRouter.get(
  '/optimise',
  requirePermission('funds.optimise'),
  validate({ query: z.object({ budgetCr: z.coerce.number().min(1).max(1_000_000).optional() }) }),
  asyncHandler((req, res) => {
    const q = v<{ budgetCr?: number }>(req, 'query');
    if (!listPolicyCards().length) refreshPolicyCards();
    res.json(runOptimiser({ budgetCr: q.budgetCr }));
  }),
);

/* ------------------------------------------------------------------ AI-8 */

aiRouter.post(
  '/ask',
  requirePermission('ask.run'),
  validate({ body: z.object({ question: z.string().min(3).max(400) }) }),
  asyncHandler((req, res) => {
    const { question } = v<{ question: string }>(req, 'body');
    const result = ask(question);
    audit(req, 'ai.ask', 'ask_civicdata', { question, intent: result.interpretation.intent, dataset: result.interpretation.dataset?.slug });
    res.json(result);
  }),
);

aiRouter.get(
  '/ask/examples',
  requirePermission('ask.run'),
  validate({ query: z.object({ run: z.enum(['true', 'false']).default('false') }) }),
  asyncHandler((req, res) => {
    const run = v<{ run: 'true' | 'false' }>(req, 'query').run === 'true';
    res.json({
      engine: 'AI-8',
      examples: EXAMPLE_QUESTIONS,
      results: run ? runExamples() : undefined,
    });
  }),
);
