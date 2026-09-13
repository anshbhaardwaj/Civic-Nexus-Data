import { useEffect, useState } from 'react';
import { TrendChart } from '../components/charts';
import { Caveat, ErrorState, NotApplicableState, SkeletonCards, SkeletonChart } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, KeyValues, PageHeader, RunButton } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { preferredAggregation, preferredMetric, useDatasets } from '../lib/datasets';
import { useAutoRun } from '../lib/hooks';
import { fmtCount, fmtNum, fmtPct, humanise, metricUnit } from '../lib/format';
import type { ForecastResponse } from '../lib/types';

export default function Forecast() {
  const { token } = useAuth();
  const { selected, byslug, forecastable, select } = useDatasets();
  const ds = byslug(selected);
  const usable = ds && ds.roles.time.length > 0 ? ds : ds;
  const [metric, setMetric] = useState('');
  const [horizon, setHorizon] = useState(5);
  const [aggregation, setAggregation] = useState<'sum' | 'avg'>('avg');

  useEffect(() => {
    const m = preferredMetric(usable);
    setMetric(m);
    setAggregation(preferredAggregation(m));
  }, [usable?.slug]);

  const effMetric = metric || preferredMetric(usable);
  const { data, error, loading, run } = useAutoRun<ForecastResponse>(
    () =>
      api<ForecastResponse>('/api/ai/forecast', {
        token,
        query: { dataset: selected, metric: effMetric, horizon, aggregation },
      }),
    `forecast:${selected}:${effMetric}:${horizon}:${aggregation}`,
    Boolean(selected && effMetric),
  );

  const header = (
    <PageHeader
      title="Forecast ensemble"
      engine="AI-3 · walk-forward model selection"
      subtitle="Three candidate models — naive with drift, Holt's linear trend and seasonal-naive with drift — are each validated by rolling-origin one-step-ahead backtesting. The lowest mean MAPE wins; intervals come from the residual standard deviation of the winner."
      actions={
        <>
          <select
            className="input py-1.5 text-2xs"
            value={effMetric}
            onChange={(e) => {
              setMetric(e.target.value);
              setAggregation(preferredAggregation(e.target.value));
            }}
            data-testid="forecast-metric"
            aria-label="Metric to forecast"
          >
            {(usable?.roles.metrics ?? []).map((m) => (
              <option key={m} value={m}>
                {humanise(m)}
              </option>
            ))}
          </select>
          <select className="input py-1.5 text-2xs" value={aggregation} onChange={(e) => setAggregation(e.target.value as 'sum' | 'avg')} data-testid="forecast-aggregation" aria-label="Aggregation">
            <option value="avg">mean across entities</option>
            <option value="sum">sum across entities</option>
          </select>
          <select className="input py-1.5 text-2xs" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} data-testid="forecast-horizon" aria-label="Horizon">
            {[1, 2, 3, 4, 5].map((h) => (
              <option key={h} value={h}>
                {h} step{h > 1 ? 's' : ''} ahead
              </option>
            ))}
          </select>
          <RunButton onClick={run} loading={loading} testid="forecast-rerun" />
        </>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="space-y-4" data-testid="forecast-page">
        {header}
        <SkeletonCards count={4} />
        <SkeletonChart height={320} />
      </div>
    );
  }

  if (error) {
    const apiErr = error instanceof ApiError ? error : null;
    return (
      <div className="space-y-4" data-testid="forecast-page">
        {header}
        {apiErr?.isNotApplicable ? (
          <NotApplicableState
            err={apiErr}
            hint={
              <div className="space-y-2">
                <p>
                  {fmtCount(forecastable.length)} of the ingested tables report the same entities every month, which is what walk-forward validation
                  needs. Switch to one of them in a click:
                </p>
                <p className="flex flex-wrap gap-1.5">
                  {forecastable
                    .filter((d) => d.slug !== selected)
                    .map((d) => (
                      <button
                        key={d.slug}
                        type="button"
                        className="btn px-2 py-1 text-2xs"
                        onClick={() => select(d.slug)}
                        data-testid={`forecast-switch-${d.slug}`}
                      >
                        {d.name}
                      </button>
                    ))}
                </p>
              </div>
            }
          />
        ) : (
          <ErrorState err={error} onRetry={run} what="the forecast" />
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" data-testid="forecast-page">
        {header}
        <SkeletonChart height={320} />
      </div>
    );
  }

  const unit = metricUnit(data.metric);
  const chart = [
    ...data.history.map((h) => ({ label: h.period, actual: h.actual, fitted: h.fitted })),
    ...data.forecast.map((f) => ({
      label: f.period,
      forecast: f.value,
      lo95: f.lo95,
      span95: f.hi95 - f.lo95,
      lo80: f.lo80,
      span80: f.hi80 - f.lo80,
    })),
  ];
  const best = data.selection[0];
  const lastActual = data.history[data.history.length - 1]?.actual ?? 0;
  const lastForecast = data.forecast[data.forecast.length - 1]?.value ?? 0;
  const change = lastActual ? ((lastForecast - lastActual) / lastActual) * 100 : 0;

  return (
    <div className="space-y-4" data-testid="forecast-page">
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Model selected" value={data.chosenModel} detail={`beat ${data.selection.length - 1} alternatives on walk-forward MAPE`} tone="teal" testid="kpi-model" />
        <Kpi label="Walk-forward MAPE" value={fmtPct(best?.walkForwardMape ?? 0)} detail={`${fmtCount(best?.folds ?? 0)} rolling-origin folds, min train ${fmtCount(data.validation.minTrain)}`} testid="kpi-mape" />
        <Kpi label={`Projected ${humanise(data.metric)}`} value={`${fmtNum(lastForecast, 2)}${unit}`} detail={`step ${data.horizon} · ${data.forecast[data.forecast.length - 1]?.period ?? ''}`} tone="saffron" testid="kpi-projection" />
        <Kpi label="Change vs latest actual" value={`${change >= 0 ? '+' : ''}${fmtNum(change, 1)}%`} detail={`latest actual ${fmtNum(lastActual, 2)}${unit} in ${data.history[data.history.length - 1]?.period ?? ''}`} tone={change >= 0 ? 'danger' : 'ok'} testid="kpi-change" />
      </div>

      <Card
        title={`${humanise(data.metric)} — ${fmtCount(data.history.length)} observed periods and ${fmtCount(data.forecast.length)} projected`}
        hint={`${data.aggregation === 'avg' ? 'Mean' : 'Sum'} across entities, grouped by ${humanise(data.timeColumn)} · shaded band is the 95% interval`}
        testid="card-forecast-chart"
      >
        <TrendChart
          data={chart}
          series={[
            { key: 'actual', name: 'Actual', colorIndex: 0 },
            { key: 'fitted', name: 'Fitted', colorIndex: 3, dashed: true },
            { key: 'forecast', name: 'Forecast', colorIndex: 1, dashed: true },
          ]}
          bands={[
            { base: 'lo95', span: 'span95', name: '95% interval', opacity: 0.14 },
            { base: 'lo80', span: 'span80', name: '80% interval', opacity: 0.2 },
          ]}
          height={340}
          unit={unit || undefined}
          testid="chart-forecast"
        />
        <Caveat>
          Intervals widen with √h because residual variance accumulates: {data.formulas['interval']}. They are model uncertainty only — they do
          not price in policy changes or structural breaks.
        </Caveat>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr]">
        <Card title="Model competition" hint="Every candidate is scored the same way; the winner is simply the lowest walk-forward MAPE" testid="card-selection">
          <DataTable
            testid="table-selection"
            rows={data.selection}
            rowKey={(s) => s.model}
            maxHeight="14rem"
            columns={[
              {
                key: 'model',
                header: 'Model',
                render: (s) => (
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{s.model}</span>
                    {s.model === data.chosenModel ? <Badge kind="acknowledged">selected</Badge> : null}
                  </span>
                ),
              },
              { key: 'walkForwardMape', header: 'Walk-forward MAPE', align: 'right', render: (s) => fmtPct(s.walkForwardMape) },
              { key: 'inSampleMape', header: 'In-sample MAPE', align: 'right', render: (s) => fmtPct(s.inSampleMape) },
              { key: 'folds', header: 'Folds', align: 'right', render: (s) => fmtCount(s.folds) },
            ]}
          />
          <div className="mt-3 space-y-2">
            <Formula label="Selection rule">{data.formulas['selection']}</Formula>
            <Formula label={`Winner — ${data.chosenModel}`}>{data.formulas[data.chosenModel] ?? '—'}</Formula>
          </div>
        </Card>

        <Card title="Projected values" hint="Point forecast with 80% and 95% intervals" testid="card-forecast-table">
          <DataTable
            testid="table-forecast"
            rows={data.forecast}
            rowKey={(f) => f.period}
            maxHeight="14rem"
            columns={[
              { key: 'period', header: 'Period', render: (f) => <span className="font-semibold text-ink">{f.period}</span> },
              { key: 'value', header: 'Forecast', align: 'right', render: (f) => `${fmtNum(f.value, 2)}${unit}` },
              { key: 'i80', header: '80% interval', align: 'right', render: (f) => `${fmtNum(f.lo80, 1)} – ${fmtNum(f.hi80, 1)}` },
              { key: 'i95', header: '95% interval', align: 'right', render: (f) => `${fmtNum(f.lo95, 1)} – ${fmtNum(f.hi95, 1)}` },
            ]}
          />
          <div className="mt-3">
            <KeyValues
              cols={2}
              items={[
                { k: 'Validation scheme', v: data.validation.scheme },
                { k: 'Seasonal period detected', v: `${fmtCount(data.seasonalPeriod)} periods` },
                { k: 'Fitted parameters', v: Object.entries(data.chosenParams).map(([k, v]) => `${k} ${fmtNum(Number(v), 3)}`).join(' · ') },
                { k: 'Aggregation', v: `${data.aggregation} over ${humanise(data.timeColumn)}` },
              ]}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
