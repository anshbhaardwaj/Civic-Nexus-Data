import { useState } from 'react';
import { CorrelationHeatmap } from '../components/charts';
import { Caveat, EmptyState, ErrorState, NotApplicableState, SkeletonCards, SkeletonChart } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, PageHeader, RunButton } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useAutoRun } from '../lib/hooks';
import { fmtCount, fmtNum, humanise } from '../lib/format';
import type { CorrelationResponse } from '../lib/types';

function pText(p: number): string {
  if (p === 0) return 'p < 1e-6';
  if (p < 0.001) return `p = ${p.toExponential(1)}`;
  return `p = ${fmtNum(p, 4)}`;
}

export default function Correlation() {
  const { token } = useAuth();
  const { selected } = useDatasets();
  const [maxLag, setMaxLag] = useState(6);
  const [view, setView] = useState<'pearson' | 'spearman'>('pearson');

  const { data, error, loading, run } = useAutoRun<CorrelationResponse>(
    () => api<CorrelationResponse>('/api/ai/correlation', { token, query: { dataset: selected, maxLag } }),
    `correlation:${selected}:${maxLag}`,
    Boolean(selected),
  );

  const header = (
    <PageHeader
      title="Correlation & causality hints"
      engine="AI-5 · Pearson, Spearman and cross-correlation"
      subtitle="Both a linear (Pearson) and a rank (Spearman) coefficient are computed for every metric pair with a two-sided t-test p-value, then series are shifted by 0–6 periods to see whether one metric consistently leads another."
      actions={
        <>
          <select className="input py-1.5 text-2xs" value={view} onChange={(e) => setView(e.target.value as 'pearson' | 'spearman')} data-testid="correlation-view" aria-label="Coefficient">
            <option value="pearson">Pearson r (linear)</option>
            <option value="spearman">Spearman ρ (rank)</option>
          </select>
          <select className="input py-1.5 text-2xs" value={maxLag} onChange={(e) => setMaxLag(Number(e.target.value))} data-testid="correlation-lag" aria-label="Maximum lag">
            {[2, 4, 6].map((l) => (
              <option key={l} value={l}>
                lags 0–{l}
              </option>
            ))}
          </select>
          <RunButton onClick={run} loading={loading} testid="correlation-rerun" />
        </>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="space-y-4" data-testid="correlation-page">
        {header}
        <SkeletonCards count={3} />
        <SkeletonChart height={300} />
      </div>
    );
  }

  if (error) {
    const apiErr = error instanceof ApiError ? error : null;
    return (
      <div className="space-y-4" data-testid="correlation-page">
        {header}
        {apiErr?.isNotApplicable ? (
          <NotApplicableState err={apiErr} hint={<p>Two or more numeric metrics are needed to correlate anything; this table does not have them.</p>} />
        ) : (
          <ErrorState err={error} onRetry={run} what="the correlation analysis" />
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" data-testid="correlation-page">
        {header}
        <SkeletonChart height={300} />
      </div>
    );
  }

  const matrix = view === 'pearson' ? data.matrix.pearson : data.matrix.spearman;
  const strongest = data.pairs[0];
  const significant = data.pairs.filter((p) => p.significant).length;

  return (
    <div className="space-y-4" data-testid="correlation-page">
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Metrics compared" value={fmtCount(data.metrics.length)} detail={`${fmtCount(data.pairs.length)} unique pairs`} testid="kpi-metrics" />
        <Kpi label="Observations" value={fmtCount(data.n)} detail="rows with all metrics present" testid="kpi-n" />
        <Kpi label="Significant at α = 0.05" value={fmtCount(significant)} detail={`${fmtCount(data.pairs.length - significant)} pairs not distinguishable from noise`} tone="teal" testid="kpi-significant" />
        <Kpi
          label="Strongest association"
          value={strongest ? fmtNum(strongest.pearson, 3) : '—'}
          detail={strongest ? `${humanise(strongest.a)} ↔ ${humanise(strongest.b)} · ${strongest.strength}` : 'no pair available'}
          tone="saffron"
          testid="kpi-strongest"
        />
      </div>

      <Card title={`${view === 'pearson' ? 'Pearson r' : 'Spearman ρ'} matrix`} hint="Teal = positive, saffron = negative; intensity tracks |r|" testid="card-heatmap">
        <CorrelationHeatmap metrics={data.metrics} matrix={matrix} testid="chart-heatmap" />
        <div className="mt-3 space-y-2">
          <Formula label="Pearson">{data.formulas['pearson']}</Formula>
          <Formula label="Spearman">{data.formulas['spearman']}</Formula>
          <Formula label="p-value">{data.formulas['pValue']}</Formula>
        </div>
      </Card>

      <Card title="Ranked pairs" hint="Sorted by |Pearson r|; the note is generated from the numbers, not written by hand" testid="card-pairs" pad={false}>
        <div className="p-3">
          <DataTable
            testid="table-pairs"
            rows={data.pairs}
            rowKey={(p) => `${p.a}|${p.b}`}
            maxHeight="26rem"
            columns={[
              {
                key: 'pair',
                header: 'Metric pair',
                render: (p) => (
                  <span className="block max-w-[16rem] truncate font-semibold text-ink" title={`${p.a} ↔ ${p.b}`}>
                    {humanise(p.a)} ↔ {humanise(p.b)}
                  </span>
                ),
              },
              { key: 'pearson', header: 'Pearson r', align: 'right', render: (p) => fmtNum(p.pearson, 4) },
              { key: 'spearman', header: 'Spearman ρ', align: 'right', render: (p) => fmtNum(p.spearman, 4) },
              { key: 'pValue', header: 'Significance', align: 'right', render: (p) => <span className="text-muted">{pText(p.pValue)}</span> },
              { key: 'n', header: 'n', align: 'right', render: (p) => fmtCount(p.n) },
              {
                key: 'strength',
                header: 'Reading',
                render: (p) => (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge kind={p.significant ? 'acknowledged' : 'low'}>{p.strength}</Badge>
                    {p.spurious ? <Badge kind="critical">spurious (n &lt; 30)</Badge> : null}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Leading indicators" hint={`Cross-correlation over lags 0–${maxLag}: does one metric move first?`} testid="card-leading">
          {data.leadingIndicators.length === 0 ? (
            <EmptyState title="No metric leads another in this dataset">
              <p>
                Every pair peaked at lag 0, so the metrics move together within the same period rather than one preceding the other. That is the
                expected result for stock measures recorded at the same instant — try a dataset where a driver and an outcome are recorded
                separately.
              </p>
            </EmptyState>
          ) : (
            <DataTable
              testid="table-leading"
              rows={data.leadingIndicators}
              rowKey={(l) => `${l.driver}|${l.target}|${l.bestLag}`}
              maxHeight="20rem"
              columns={[
                { key: 'driver', header: 'Leads', render: (l) => <span className="font-semibold text-ink">{humanise(l.driver)}</span> },
                { key: 'target', header: 'Follows', render: (l) => humanise(l.target) },
                { key: 'bestLag', header: 'Best lag', align: 'right', render: (l) => `${fmtCount(l.bestLag)} periods` },
                { key: 'r', header: 'r at lag', align: 'right', render: (l) => fmtNum(l.r, 4) },
              ]}
            />
          )}
          <div className="mt-3">
            <Formula label="Cross-correlation">{data.formulas['crossCorrelation']}</Formula>
          </div>
        </Card>

        <Card title="How to read this page" hint="The caveats are returned by the engine itself" testid="card-caveats">
          <ul className="space-y-2">
            {data.caveats.map((c) => (
              <li key={c}>
                <Caveat>{c}</Caveat>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.8rem] leading-relaxed text-muted">
            A high coefficient between two metrics from the same table often reflects a shared driver — population, seasonality or a definitional
            overlap such as an index computed from its own components. Use these pairs to decide what to monitor together, not to justify a
            causal claim in a cabinet note.
          </p>
        </Card>
      </div>
    </div>
  );
}
