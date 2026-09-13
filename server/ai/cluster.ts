/**
 * AI-4 — k-means++ clustering with silhouette-based k selection (SPEC §5).
 *
 * Features are z-normalised: z = (x - mean) / stddev.
 * Init: k-means++ (D² weighted seeding). Lloyd iterations until assignments
 * stabilise or 100 iterations. k chosen by maximising the mean silhouette
 * coefficient s(i) = (b(i) - a(i)) / max(a(i), b(i)) over k = 2..8.
 * Cluster profiles are reported back in original units, plus a plain-English
 * label derived from which features sit furthest from the global mean.
 */
import { Rng } from '../lib/rng';
import { DatasetRow, aggregateByDimension, dimensionColumns, metricColumns } from '../lib/datasets';
import { ApiError } from '../lib/http';
import { mean, round, stddev } from '../lib/stats';

export interface ClusterResult {
  engine: 'AI-4';
  dataset: { id: number; slug: string; name: string };
  unit: string;
  features: string[];
  kEvaluated: { k: number; silhouette: number; inertia: number }[];
  kChosen: number;
  silhouette: number;
  formulas: Record<string, string>;
  clusters: {
    cluster: number;
    label: string;
    size: number;
    members: string[];
    centroidZ: Record<string, number>;
    centroidOriginal: Record<string, number>;
    profile: { feature: string; value: number; globalMean: number; zOffset: number; direction: 'above' | 'below' }[];
    meanSilhouette: number;
  }[];
  points: { key: string; cluster: number; silhouette: number; distanceToCentroid: number }[];
}

function euclid(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function kmeansPlusPlus(data: number[][], k: number, rng: Rng): number[][] {
  const centroids: number[][] = [data[Math.floor(rng.next() * data.length)].slice()];
  while (centroids.length < k) {
    const d2 = data.map((p) => Math.min(...centroids.map((c) => euclid(p, c))) ** 2);
    const total = d2.reduce((a, b) => a + b, 0);
    if (total === 0) {
      centroids.push(data[Math.floor(rng.next() * data.length)].slice());
      continue;
    }
    let r = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < d2.length; i++) {
      r -= d2[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push(data[idx].slice());
  }
  return centroids;
}

function lloyd(data: number[][], k: number, rng: Rng): { assign: number[]; centroids: number[][]; inertia: number } {
  let centroids = kmeansPlusPlus(data, k, rng);
  let assign = new Array(data.length).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (let i = 0; i < data.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclid(data[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const sums = Array.from({ length: k }, () => new Array(data[0].length).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < data.length; i++) {
      counts[assign[i]]++;
      for (let j = 0; j < data[0].length; j++) sums[assign[i]][j] += data[i][j];
    }
    centroids = centroids.map((c, ci) =>
      counts[ci] ? sums[ci].map((s) => s / counts[ci]) : data[Math.floor(rng.next() * data.length)].slice(),
    );
    if (!changed && iter > 0) break;
  }
  const inertia = data.reduce((a, p, i) => a + euclid(p, centroids[assign[i]]) ** 2, 0);
  return { assign, centroids, inertia };
}

function silhouettes(data: number[][], assign: number[], k: number): number[] {
  const byCluster: number[][] = Array.from({ length: k }, () => []);
  assign.forEach((c, i) => byCluster[c].push(i));
  return data.map((p, i) => {
    const own = byCluster[assign[i]];
    if (own.length <= 1) return 0;
    const a = mean(own.filter((j) => j !== i).map((j) => euclid(p, data[j])));
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === assign[i] || !byCluster[c].length) continue;
      const d = mean(byCluster[c].map((j) => euclid(p, data[j])));
      if (d < b) b = d;
    }
    if (!Number.isFinite(b)) return 0;
    return (b - a) / Math.max(a, b);
  });
}

export interface ClusterOptions {
  dimension?: string;
  features?: string[];
  k?: number;
  aggregation?: 'sum' | 'avg';
}

export function runClustering(ds: DatasetRow, opts: ClusterOptions = {}): ClusterResult {
  const dims = dimensionColumns(ds.id);
  const dimension = opts.dimension && dims.some((d) => d.name === opts.dimension) ? opts.dimension : dims[0]?.name;
  if (!dimension) throw ApiError.notApplicable(`Dataset '${ds.slug}' has no dimension column to cluster over`);
  const allMetrics = metricColumns(ds.id).map((c) => c.name);
  const features = (opts.features?.length ? opts.features.filter((f) => allMetrics.includes(f)) : allMetrics).slice(0, 8);
  if (features.length < 2) throw ApiError.notApplicable('Clustering needs at least 2 numeric metrics', { availableMetrics: allMetrics });

  const groups = aggregateByDimension(ds, dimension, features, opts.aggregation ?? 'avg');
  if (groups.length < 4) {
    throw ApiError.notApplicable(
      `Only ${groups.length} distinct '${dimension}' values; clustering needs at least 4 units.`,
      { units: groups.length },
    );
  }
  const raw = groups.map((g) => features.map((f) => g.values[f]));
  const mus = features.map((_, j) => mean(raw.map((r) => r[j])));
  const sds = features.map((_, j) => stddev(raw.map((r) => r[j])) || 1);
  const z = raw.map((r) => r.map((v, j) => (v - mus[j]) / sds[j]));

  const rng = new Rng(`kmeans:${ds.slug}:${dimension}`);
  const maxK = Math.min(8, groups.length - 1);
  const evaluated: { k: number; silhouette: number; inertia: number }[] = [];
  let best: { k: number; assign: number[]; centroids: number[][]; sil: number[]; score: number } | null = null;
  const kRange = opts.k ? [Math.min(Math.max(2, opts.k), maxK)] : Array.from({ length: Math.max(1, maxK - 1) }, (_, i) => i + 2);
  for (const k of kRange) {
    const { assign, centroids, inertia } = lloyd(z, k, new Rng(`kmeans:${ds.slug}:${dimension}:${k}`));
    const sil = silhouettes(z, assign, k);
    const score = mean(sil);
    evaluated.push({ k, silhouette: round(score, 4), inertia: round(inertia, 3) });
    if (!best || score > best.score) best = { k, assign, centroids, sil, score };
  }
  if (!best) throw ApiError.notApplicable('Clustering failed to converge');

  const k = best.k;
  const clusters = Array.from({ length: k }, (_, c) => {
    const members = groups.filter((_, i) => best!.assign[i] === c);
    const memberIdx = groups.map((_, i) => i).filter((i) => best!.assign[i] === c);
    const centroidOriginal = Object.fromEntries(
      features.map((f, j) => [f, round(mean(memberIdx.map((i) => raw[i][j])) || 0, 3)]),
    );
    const profile = features.map((f, j) => {
      const val = centroidOriginal[f];
      return {
        feature: f,
        value: val,
        globalMean: round(mus[j], 3),
        zOffset: round(best!.centroids[c][j], 3),
        direction: (best!.centroids[c][j] >= 0 ? 'above' : 'below') as 'above' | 'below',
      };
    });
    const strongest = [...profile].sort((a, b) => Math.abs(b.zOffset) - Math.abs(a.zOffset)).slice(0, 2);
    const label = strongest.length
      ? `${strongest
          .map((p) => `${p.direction === 'above' ? 'high' : 'low'} ${p.feature.replace(/_/g, ' ')}`)
          .join(', ')} (${members.length} ${dimension.replace(/_/g, ' ')}${members.length === 1 ? '' : 's'})`
      : `cluster ${c + 1}`;
    return {
      cluster: c,
      label,
      size: members.length,
      members: members.map((m) => m.key),
      centroidZ: Object.fromEntries(features.map((f, j) => [f, round(best!.centroids[c][j], 4)])),
      centroidOriginal,
      profile,
      meanSilhouette: round(mean(memberIdx.map((i) => best!.sil[i])) || 0, 4),
    };
  });

  return {
    engine: 'AI-4',
    dataset: { id: ds.id, slug: ds.slug, name: ds.name },
    unit: dimension,
    features,
    kEvaluated: evaluated,
    kChosen: k,
    silhouette: round(best.score, 4),
    formulas: {
      normalisation: 'z = (x - mean) / stddev per feature',
      init: 'k-means++ : P(pick x) proportional to D(x)^2',
      objective: 'minimise sum over clusters of squared euclidean distance to centroid (inertia)',
      silhouette: 's(i) = (b(i) - a(i)) / max(a(i), b(i))',
      kSelection: 'argmax over k in 2..8 of mean silhouette',
    },
    clusters,
    points: groups.map((g, i) => ({
      key: g.key,
      cluster: best!.assign[i],
      silhouette: round(best!.sil[i], 4),
      distanceToCentroid: round(euclid(z[i], best!.centroids[best!.assign[i]]), 4),
    })),
  };
}
