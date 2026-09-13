import { useState } from 'react';
import { Trees } from 'lucide-react';
import { RankedBars } from '../components/charts';
import { Caveat, EmptyState, ErrorState, NotApplicableState, SkeletonCards, SkeletonChart } from '../components/states';
import { Card, DataTable, Formula, Kpi, KeyValues, PageHeader, RunButton } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useAutoRun } from '../lib/hooks';
import { fmtCount, fmtNum, fmtPct, humanise } from '../lib/format';
import type { IForestResponse } from '../lib/types';

export default function IsolationForest() {
  const { token } = useAuth();
  const { selected } = useDatasets();
  const [trees, setTrees] = useState(100);
  const [topN, setTopN] = useState(15);
  const [pick, setPick] = useState<number | null>(null);

  const { data, error, loading, run } = useAutoRun<IForestResponse>(
    () => api<IForestResponse>('/api/ai/isolation-forest', { token, query: { dataset: selected, trees, topN } }),
    `iforest:${selected}:${trees}:${topN}`,
    Boolean(selected),
  );

  const header = (
    <PageHeader
      title="Isolation forest"
      engine="AI-2 · unsupervised multivariate outliers"
      subtitle="Random split trees isolate unusual rows in fewer splits, so a short expected path length means a high anomaly score. Attribution comes from ablation: each feature is replaced by the training median and the score drop is its contribution."
      actions={
        <>
          <select className="input py-1.5 text-2xs" value={trees} onChange={(e) => setTrees(Number(e.target.value))} data-testid="iforest-trees" aria-label="Number of trees">
            {[50, 100, 200].map((t) => (
              <option key={t} value={t}>
                {t} trees
              </option>
            ))}
          </select>
          <select className="input py-1.5 text-2xs" value={topN} onChange={(e) => setTopN(Number(e.target.value))} data-testid="iforest-topn" aria-label="Rows returned">
            {[10, 15, 25, 50].map((t) => (
              <option key={t} value={t}>
                top {t}
              </option>
            ))}
          </select>
          <RunButton onClick={run} loading={loading} testid="iforest-rerun" />
        </>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="space-y-4" data-testid="isolation-forest-page">
        {header}
        <SkeletonCards count={4} />
        <SkeletonChart height={300} />
      </div>
    );
  }

  if (error) {
    const apiErr = error instanceof ApiError ? error : null;
    return (
      <div className="space-y-4" data-testid="isolation-forest-page">
        {header}
        {apiErr?.isNotApplicable ? (
          <NotApplicableState err={apiErr} hint={<p>The forest needs at least two numeric feature columns to isolate a row against; pick a dataset with more metrics.</p>} />
        ) : (
          <ErrorState err={error} onRetry={run} what="the isolation forest" />
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" data-testid="isolation-forest-page">
        {header}
        <SkeletonChart height={300} />
      </div>
    );
  }

  const active = data.outliers.find((o) => o.rowId === pick) ?? data.outliers[0];

  return (
    <div className="space-y-4" data-testid="isolation-forest-page">
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Rows scored" value={fmtCount(data.rowsScored)} detail={`${data.features.length} numeric features, ψ = ${fmtCount(data.params.psi)} per tree`} testid="kpi-rows-scored" />
        <Kpi label="Rows flagged" value={fmtCount(data.flagged)} detail={`${fmtPct((data.flagged / Math.max(1, data.rowsScored)) * 100)} of the table`} tone="danger" testid="kpi-flagged" />
        <Kpi label="Threshold used" value={fmtNum(data.thresholdUsed, 4)} detail={data.thresholdFormula} tone="saffron" testid="kpi-threshold" />
        <Kpi label="Score distribution" value={`μ ${fmtNum(data.scoreStats.mean, 4)}`} detail={`σ ${fmtNum(data.scoreStats.stddev, 4)} · range ${fmtNum(data.scoreStats.min, 3)}–${fmtNum(data.scoreStats.max, 3)}`} tone="teal" testid="kpi-score-stats" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr]">
        <Card title="Highest-scoring rows" hint="Select a row to see which features isolated it" testid="card-outliers" pad={false}>
          <div className="p-3">
            {data.outliers.length === 0 ? (
              <EmptyState title="No row crossed the flagging threshold">
                <p>
                  Every scored row stayed below {fmtNum(data.thresholdUsed, 4)}, which means this table is multivariately homogeneous at ψ ={' '}
                  {fmtCount(data.params.psi)}. Increase the tree count or choose a wider dataset to probe harder.
                </p>
              </EmptyState>
            ) : (
              <DataTable
                testid="table-outliers"
                rows={data.outliers}
                rowKey={(o) => o.rowId}
                maxHeight="26rem"
                onRowClick={(o) => setPick(o.rowId)}
                rowTestid={(o) => `outlier-row-${o.rowId}`}
                columns={[
                  {
                    key: 'label',
                    header: 'Row',
                    render: (o) => (
                      <span className="block max-w-[14rem] truncate font-semibold text-ink" title={o.label}>
                        {o.label}
                        <span className="block text-2xs font-normal text-faint">source row #{o.rowId}</span>
                      </span>
                    ),
                  },
                  { key: 'score', header: 'Score', align: 'right', render: (o) => fmtNum(o.score, 4) },
                  { key: 'pathLength', header: 'Mean path', align: 'right', render: (o) => fmtNum(o.pathLength, 3) },
                  {
                    key: 'top',
                    header: 'Dominant feature',
                    render: (o) => (
                      <span className="block max-w-[13rem] truncate text-muted" title={o.contributions[0]?.feature}>
                        {humanise(o.contributions[0]?.feature ?? '—')} · {fmtPct(o.contributions[0]?.sharePct ?? 0, 0)}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </Card>

        <Card title="Score histogram" hint="Ten equal buckets across the 0–1 score range" testid="card-histogram">
          <RankedBars
            data={data.histogram.filter((h) => h.count > 0).map((h) => ({ label: h.bucket, value: h.count }))}
            unit="rows"
            height={280}
            testid="chart-histogram"
          />
          <Caveat>
            An isolation-forest score is relative to this table only — 0.55 here is not comparable to 0.55 on a different dataset, because c(ψ)
            normalisation depends on the sample size.
          </Caveat>
        </Card>
      </div>

      {active ? (
        <Card title={`Attribution — ${active.label}`} hint="Ablation shares sum to 100% of the score drop" testid="card-attribution">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="min-w-0">
              <RankedBars
                data={active.contributions.map((c) => ({ label: humanise(c.feature), value: c.sharePct }))}
                unit="% of score drop"
                height={Math.max(180, active.contributions.length * 34)}
                testid="chart-attribution"
                colorIndex={1}
              />
            </div>
            <div className="min-w-0">
              <DataTable
                testid="table-attribution"
                rows={active.contributions}
                rowKey={(c) => c.feature}
                maxHeight="16rem"
                columns={[
                  { key: 'feature', header: 'Feature', render: (c) => <span className="font-semibold text-ink">{humanise(c.feature)}</span> },
                  { key: 'value', header: 'This row', align: 'right', render: (c) => fmtNum(c.value, 2) },
                  { key: 'trainingMedian', header: 'Training median', align: 'right', render: (c) => fmtNum(c.trainingMedian, 2) },
                  { key: 'contribution', header: 'Δ score', align: 'right', render: (c) => fmtNum(c.contribution, 5) },
                  { key: 'sharePct', header: 'Share', align: 'right', render: (c) => fmtPct(c.sharePct, 1) },
                ]}
              />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <Formula label="Score">{data.formula}</Formula>
            <KeyValues
              cols={3}
              items={[
                { k: 'Trees', v: fmtCount(data.params.trees) },
                { k: 'Subsample ψ', v: fmtCount(data.params.psi) },
                { k: 'Depth limit', v: fmtCount(data.params.depthLimit) },
                { k: 'c(ψ) normaliser', v: fmtNum(data.params.cPsi, 4) },
                { k: 'Seed', v: <span className="font-mono text-2xs">{data.params.seed}</span> },
                { k: 'Features used', v: data.features.map(humanise).join(', ') },
              ]}
            />
            <p className="flex items-center gap-1.5 text-2xs text-faint">
              <Trees size={12} aria-hidden /> The seed is derived from the dataset slug, so this exact forest is reproducible on demand.
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
