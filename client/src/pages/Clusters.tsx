import { useState } from 'react';
import { ClusterScatter, RankedBars } from '../components/charts';
import { Caveat, ErrorState, NotApplicableState, SkeletonCards, SkeletonChart } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, PageHeader, RunButton } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useAutoRun } from '../lib/hooks';
import { fmtCount, fmtNum, humanise } from '../lib/format';
import type { ClusterResponse } from '../lib/types';

export default function Clusters() {
  const { token } = useAuth();
  const { selected, byslug } = useDatasets();
  const ds = byslug(selected);
  const [dimension, setDimension] = useState('');
  const [k, setK] = useState('auto');

  const dims = ds?.roles.dimensions ?? [];
  const effDim = dimension && dims.includes(dimension) ? dimension : (dims[0] ?? '');

  const { data, error, loading, run } = useAutoRun<ClusterResponse>(
    () =>
      api<ClusterResponse>('/api/ai/clusters', {
        token,
        query: k === 'auto' ? { dataset: selected, dimension: effDim } : { dataset: selected, dimension: effDim, k: Number(k) },
      }),
    `clusters:${selected}:${effDim}:${k}`,
    Boolean(selected && effDim),
  );

  const header = (
    <PageHeader
      title="Clustering"
      engine="AI-4 · k-means++ with silhouette model selection"
      subtitle="Features are z-scored so no unit dominates, centroids are seeded with k-means++ and k is not guessed: every k from 2 to 8 is fitted and the one with the highest mean silhouette wins."
      actions={
        <>
          <select className="input py-1.5 text-2xs" value={effDim} onChange={(e) => setDimension(e.target.value)} data-testid="clusters-dimension" aria-label="Unit of analysis">
            {dims.map((d) => (
              <option key={d} value={d}>
                by {humanise(d)}
              </option>
            ))}
          </select>
          <select className="input py-1.5 text-2xs" value={k} onChange={(e) => setK(e.target.value)} data-testid="clusters-k" aria-label="Cluster count">
            <option value="auto">k chosen by silhouette</option>
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={String(n)}>
                force k = {n}
              </option>
            ))}
          </select>
          <RunButton onClick={run} loading={loading} testid="clusters-rerun" />
        </>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="space-y-4" data-testid="clusters-page">
        {header}
        <SkeletonCards count={4} />
        <SkeletonChart height={320} />
      </div>
    );
  }

  if (error) {
    const apiErr = error instanceof ApiError ? error : null;
    return (
      <div className="space-y-4" data-testid="clusters-page">
        {header}
        {apiErr?.isNotApplicable ? (
          <NotApplicableState err={apiErr} hint={<p>Clustering needs at least two numeric features and more distinct units than clusters. Choose another dimension or dataset.</p>} />
        ) : (
          <ErrorState err={error} onRetry={run} what="the clustering run" />
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" data-testid="clusters-page">
        {header}
        <SkeletonChart height={320} />
      </div>
    );
  }

  const [fx, fy] = [data.features[0] ?? '', data.features[1] ?? data.features[0] ?? ''];
  const groups = data.clusters.map((c) => ({
    name: `Cluster ${c.cluster} · ${fmtCount(c.size)}`,
    points: c.members.map((m) => {
      const centroid = c.centroidOriginal;
      return { x: centroid[fx] ?? 0, y: centroid[fy] ?? 0, label: `${m} (cluster ${c.cluster})` };
    }),
  }));

  const scatter = data.clusters.map((c) => ({
    name: `Cluster ${c.cluster}`,
    points: [{ x: c.centroidOriginal[fx] ?? 0, y: c.centroidOriginal[fy] ?? 0, label: `${c.label}` }],
  }));

  return (
    <div className="space-y-4" data-testid="clusters-page">
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Clusters chosen" value={fmtCount(data.kChosen)} detail={`best of k = 2…8 by mean silhouette`} tone="teal" testid="kpi-k" />
        <Kpi label="Mean silhouette" value={fmtNum(data.silhouette, 4)} detail="1 = perfectly separated, 0 = on a boundary" testid="kpi-silhouette" />
        <Kpi label={`Units clustered (${humanise(data.unit)})`} value={fmtCount(data.points.length)} detail={`${data.features.length} z-scored features`} testid="kpi-units" />
        <Kpi label="Largest cluster" value={fmtCount(Math.max(...data.clusters.map((c) => c.size)))} detail={data.clusters.reduce((a, b) => (b.size > a.size ? b : a)).label} tone="saffron" testid="kpi-largest" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Card title={`Centroids — ${humanise(fx)} vs ${humanise(fy)}`} hint="Each marker is a cluster centroid in original units" testid="card-scatter">
          <ClusterScatter groups={scatter} xName={humanise(fx)} yName={humanise(fy)} height={320} testid="chart-clusters" />
          <Caveat>
            Only two of {data.features.length} dimensions can be drawn at once; separation is computed in the full z-scored feature space, which is
            why two centroids can look close here yet still score a high silhouette.
          </Caveat>
        </Card>

        <Card title="Silhouette by k" hint={data.formulas['kSelection']} testid="card-k-sweep">
          <RankedBars
            data={data.kEvaluated.map((e) => ({ label: `k = ${e.k}`, value: e.silhouette }))}
            unit="mean silhouette"
            height={260}
            testid="chart-k-sweep"
            colorBy={(row) => (String(row['label']) === `k = ${data.kChosen}` ? '#FF9933' : '#2DD4BF')}
          />
          <Caveat>Inertia always falls as k rises, so it cannot pick k on its own — silhouette penalises splitting a genuine group.</Caveat>
        </Card>
      </div>

      <Card title="Cluster profiles" hint="Every cluster is described against the global mean of each feature, not by a name a human invented" testid="card-profiles">
        <div className="space-y-3">
          {data.clusters.map((c) => (
            <article key={c.cluster} className="min-w-0 rounded-lg border border-line bg-raised p-3" data-testid={`cluster-${c.cluster}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind="medium">Cluster {c.cluster}</Badge>
                <span className="text-sm font-bold text-ink">{c.label}</span>
                <span className="chip">{fmtCount(c.size)} {humanise(data.unit)}s</span>
                <span className="chip">mean silhouette {fmtNum(c.meanSilhouette, 3)}</span>
              </div>
              <p className="mt-2 flex flex-wrap gap-1.5" data-testid={`cluster-members-${c.cluster}`}>
                {c.members.map((m) => (
                  <span key={m} className="chip max-w-[12rem] truncate" title={m}>
                    {m}
                  </span>
                ))}
              </p>
              <div className="mt-3 overflow-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr>
                      <th className="th">Feature</th>
                      <th className="th text-right">Centroid</th>
                      <th className="th text-right">Global mean</th>
                      <th className="th text-right">z offset</th>
                      <th className="th">Reads as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.profile.map((p) => (
                      <tr key={p.feature} className="border-t border-line/60">
                        <td className="td font-semibold text-ink">{humanise(p.feature)}</td>
                        <td className="td num text-right">{fmtNum(p.value, 2)}</td>
                        <td className="td num text-right text-muted">{fmtNum(p.globalMean, 2)}</td>
                        <td className={`td num text-right font-bold ${p.zOffset >= 0 ? 'text-saffron' : 'text-teal'}`}>
                          {p.zOffset >= 0 ? '+' : ''}
                          {fmtNum(p.zOffset, 3)}
                        </td>
                        <td className="td text-muted">
                          {fmtNum(Math.abs(p.zOffset), 2)}σ {p.direction} the all-unit mean
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <Formula label="Normalisation">{data.formulas['normalisation']}</Formula>
          <Formula label="Initialisation">{data.formulas['init']}</Formula>
          <Formula label="Silhouette">{data.formulas['silhouette']}</Formula>
        </div>
      </Card>

      <Card title="Per-unit assignment" hint="Silhouette and distance to centroid for every unit — low silhouette means a borderline member" testid="card-points" pad={false}>
        <div className="p-3">
          <DataTable
            testid="table-points"
            rows={[...data.points].sort((a, b) => a.silhouette - b.silhouette)}
            rowKey={(p) => p.key}
            maxHeight="22rem"
            columns={[
              { key: 'key', header: humanise(data.unit), render: (p) => <span className="block max-w-[14rem] truncate font-semibold text-ink" title={p.key}>{p.key}</span> },
              { key: 'cluster', header: 'Cluster', render: (p) => <Badge kind="medium">{p.cluster}</Badge> },
              { key: 'silhouette', header: 'Silhouette', align: 'right', render: (p) => fmtNum(p.silhouette, 4) },
              { key: 'distanceToCentroid', header: 'Distance to centroid', align: 'right', render: (p) => fmtNum(p.distanceToCentroid, 4) },
              {
                key: 'read',
                header: 'Membership strength',
                render: (p) => (
                  <span className="text-muted">
                    {p.silhouette > 0.7 ? 'strong' : p.silhouette > 0.5 ? 'reasonable' : p.silhouette > 0.25 ? 'weak' : 'borderline — sits between clusters'}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>
      <p className="text-2xs text-faint">
        {groups.length} clusters over {fmtCount(data.points.length)} units; clustering is descriptive, so a cluster label is a summary of the
        z-offsets shown above and not a judgement about performance.
      </p>
    </div>
  );
}
