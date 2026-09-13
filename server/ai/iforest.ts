/**
 * AI-2 — Isolation Forest (SPEC §5), real iTree ensemble, no ML libraries.
 *
 * Training: t = 100 trees, each on a random subsample of ψ = 256 rows,
 * split on a random feature at a uniformly random value inside that node's
 * observed range, depth limit = ceil(log2(ψ)).
 * Scoring:  E(h) = mean path length across trees (with the standard
 *           c(n) = 2H(n-1) - 2(n-1)/n unsuccessful-search adjustment)
 *           score = 2^(-E(h)/c(ψ))
 * Threshold: max(0.5, mean + 2·stddev) of the scored population.
 * Attribution: per-feature contribution by ablation — replace the feature with
 * the training median and re-score the same forest; drop in score = contribution.
 */
import { Rng } from '../lib/rng';
import { DatasetRow, getColumns, getRows, metricColumns } from '../lib/datasets';
import { ApiError } from '../lib/http';
import { mean, median, round, stddev } from '../lib/stats';

interface INode {
  feature: number;
  split: number;
  left: INode | null;
  right: INode | null;
  size: number;
  depth: number;
}

const PSI = 256;
const TREES = 100;

function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649015329) - (2 * (n - 1)) / n;
}

function buildTree(data: number[][], depth: number, limit: number, rng: Rng): INode {
  const n = data.length;
  if (depth >= limit || n <= 1) return { feature: -1, split: 0, left: null, right: null, size: n, depth };
  const dims = data[0].length;
  // choose a feature that actually varies in this node
  const order = rng.shuffle(Array.from({ length: dims }, (_, i) => i));
  let feature = -1;
  let lo = 0;
  let hi = 0;
  for (const f of order) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const row of data) {
      const v = row[f];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx > mn) {
      feature = f;
      lo = mn;
      hi = mx;
      break;
    }
  }
  if (feature < 0) return { feature: -1, split: 0, left: null, right: null, size: n, depth };
  const split = lo + rng.next() * (hi - lo);
  const left: number[][] = [];
  const right: number[][] = [];
  for (const row of data) (row[feature] < split ? left : right).push(row);
  return {
    feature,
    split,
    size: n,
    depth,
    left: buildTree(left, depth + 1, limit, rng),
    right: buildTree(right, depth + 1, limit, rng),
  };
}

function pathLength(node: INode, x: number[], depth = 0): number {
  if (node.feature < 0 || !node.left || !node.right) return depth + cFactor(node.size);
  return x[node.feature] < node.split
    ? pathLength(node.left, x, depth + 1)
    : pathLength(node.right, x, depth + 1);
}

export interface IForestOptions {
  trees?: number;
  psi?: number;
  seed?: number | string;
  topN?: number;
  features?: string[];
}

export interface IForestResult {
  engine: 'AI-2';
  dataset: { id: number; slug: string; name: string };
  features: string[];
  params: { trees: number; psi: number; depthLimit: number; cPsi: number; seed: string };
  formula: string;
  rowsScored: number;
  scoreStats: { mean: number; stddev: number; min: number; max: number };
  thresholdUsed: number;
  thresholdFormula: string;
  flagged: number;
  outliers: {
    rowId: number;
    label: string;
    score: number;
    pathLength: number;
    values: Record<string, number>;
    contributions: { feature: string; contribution: number; sharePct: number; value: number; trainingMedian: number }[];
  }[];
  histogram: { bucket: string; count: number }[];
}

export function runIsolationForest(ds: DatasetRow, opts: IForestOptions = {}): IForestResult {
  const trees = opts.trees ?? TREES;
  const psi = opts.psi ?? PSI;
  const seed = String(opts.seed ?? `iforest:${ds.slug}`);
  const allMetrics = metricColumns(ds.id).map((c) => c.name);
  const features = (opts.features?.length ? opts.features.filter((f) => allMetrics.includes(f)) : allMetrics).slice(0, 12);
  if (features.length < 2) {
    throw ApiError.notApplicable(
      `Isolation forest needs at least 2 numeric metric columns; dataset '${ds.slug}' exposes ${features.length}.`,
      { availableMetrics: allMetrics },
    );
  }
  const labelCols = getColumns(ds.id)
    .filter((c) => c.semantic_role === 'dimension' || c.semantic_role === 'identifier' || c.semantic_role === 'time')
    .slice(0, 3)
    .map((c) => c.name);

  const rows = getRows(ds, { columns: [...features, ...labelCols] });
  const clean = rows.filter((r) => features.every((f) => typeof r[f] === 'number' && Number.isFinite(r[f] as number)));
  if (clean.length < 20) throw ApiError.notApplicable('Not enough complete numeric rows to fit an isolation forest', { rows: clean.length });

  const matrix = clean.map((r) => features.map((f) => Number(r[f])));
  const medians = features.map((_, j) => median(matrix.map((row) => row[j])));

  const rng = new Rng(seed);
  const depthLimit = Math.ceil(Math.log2(Math.max(2, Math.min(psi, matrix.length))));
  const forest: INode[] = [];
  for (let t = 0; t < trees; t++) {
    const sampleSize = Math.min(psi, matrix.length);
    const idx = rng.shuffle(Array.from({ length: matrix.length }, (_, i) => i)).slice(0, sampleSize);
    forest.push(buildTree(idx.map((i) => matrix[i].slice()), 0, depthLimit, rng));
  }
  const cPsi = cFactor(Math.min(psi, matrix.length));

  const score = (x: number[]): { score: number; path: number } => {
    let sum = 0;
    for (const tree of forest) sum += pathLength(tree, x);
    const eh = sum / forest.length;
    return { score: Math.pow(2, -eh / cPsi), path: eh };
  };

  const scored = matrix.map((x, i) => {
    const s = score(x);
    return { i, ...s };
  });
  const scores = scored.map((s) => s.score);
  const mu = mean(scores);
  const sd = stddev(scores);
  const threshold = Math.max(0.5, mu + 2 * sd);
  const flagged = scored.filter((s) => s.score >= threshold).sort((a, b) => b.score - a.score);
  const topN = opts.topN ?? 25;

  const outliers = flagged.slice(0, topN).map((s) => {
    const x = matrix[s.i];
    const contributions = features.map((f, j) => {
      const ablated = x.slice();
      ablated[j] = medians[j];
      const drop = s.score - score(ablated).score;
      return { feature: f, contribution: round(drop, 5), value: round(x[j], 3), trainingMedian: round(medians[j], 3) };
    });
    const positive = contributions.reduce((a, c) => a + Math.max(0, c.contribution), 0) || 1;
    return {
      rowId: Number(clean[s.i].row_id),
      label: labelCols.map((c) => clean[s.i][c]).filter((v) => v != null && v !== '').join(' · ') || `row ${clean[s.i].row_id}`,
      score: round(s.score, 4),
      pathLength: round(s.path, 3),
      values: Object.fromEntries(features.map((f, j) => [f, round(x[j], 3)])),
      contributions: contributions
        .map((c) => ({ ...c, sharePct: round((Math.max(0, c.contribution) / positive) * 100, 1) }))
        .sort((a, b) => b.contribution - a.contribution),
    };
  });

  const buckets = new Array(10).fill(0);
  for (const s of scores) buckets[Math.min(9, Math.floor(s * 10))]++;

  return {
    engine: 'AI-2',
    dataset: { id: ds.id, slug: ds.slug, name: ds.name },
    features,
    params: { trees, psi: Math.min(psi, matrix.length), depthLimit, cPsi: round(cPsi, 4), seed },
    formula: 's(x) = 2^(-E(h(x)) / c(psi)), c(n) = 2·(ln(n-1)+0.5772156649) - 2(n-1)/n',
    rowsScored: matrix.length,
    scoreStats: { mean: round(mu, 4), stddev: round(sd, 4), min: round(Math.min(...scores), 4), max: round(Math.max(...scores), 4) },
    thresholdUsed: round(threshold, 4),
    thresholdFormula: 'max(0.5, mean(s) + 2·stddev(s))',
    flagged: flagged.length,
    outliers,
    histogram: buckets.map((count, i) => ({ bucket: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`, count })),
  };
}
