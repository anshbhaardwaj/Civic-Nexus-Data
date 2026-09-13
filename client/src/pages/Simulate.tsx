import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { TrendChart, type SeriesPoint } from '../components/charts';
import { Caveat, ErrorState, SkeletonCards, SkeletonChart } from '../components/states';
import { Card, DataTable, Formula, Kpi, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { fmtCount, fmtCr, fmtNum, fmtPct, humanise, prettifyMoney } from '../lib/format';
import type { AssumptionsResponse, Levers, SimulateResponse } from '../lib/types';

interface LeverSpec {
  key: keyof Levers;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  note: string;
}

const LEVERS: LeverSpec[] = [
  { key: 'budgetReallocationPct', label: 'Idle capital reallocated', min: 0, max: 50, step: 1, unit: '%', note: 'share of measured unspent scheme money redeployed' },
  { key: 'hospitalBedsAdded', label: 'Hospital beds added', min: 0, max: 3000, step: 50, unit: 'beds', note: 'phased in over two years across all districts' },
  { key: 'ambulancesAdded', label: 'Ambulances added', min: 0, max: 300, step: 5, unit: 'vehicles', note: 'fleet growth drives the response-time elasticity' },
  { key: 'staffHired', label: 'Clinical staff hired', min: 0, max: 5000, step: 100, unit: 'staff', note: 'nurses and doctors, recurring salary cost' },
  { key: 'waterCapexPct', label: 'Water capex uplift', min: 0, max: 60, step: 1, unit: '%', note: 'applied to the Jal Jeevan household gap' },
  { key: 'roadRepairCapexCr', label: 'Bridge & road repair capex', min: 0, max: 2000, step: 25, unit: '₹ cr', note: 'against the measured distressed-bridge backlog' },
  { key: 'enforcementIntensity', label: 'Traffic enforcement intensity', min: 0, max: 100, step: 5, unit: 'index', note: 'congestion response is deliberately sub-linear' },
];

export default function Simulate() {
  const { token } = useAuth();
  const { push } = useToast();
  const [levers, setLevers] = useState<Levers | null>(null);
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { data: base, error: baseError, loading: baseLoading, run: reloadBase } = useAutoRun<AssumptionsResponse>(
    () => api<AssumptionsResponse>('/api/simulate/assumptions', { token }),
    'sim-assumptions',
  );

  useEffect(() => {
    if (base && !levers) setLevers(base.defaultLevers);
  }, [base, levers]);

  useEffect(() => {
    if (!levers) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await api<SimulateResponse>('/api/simulate', { token, method: 'POST', body: levers });
        if (!cancelled) {
          setResult(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [levers, token]);

  function set(key: keyof Levers, value: number) {
    setLevers((l) => (l ? { ...l, [key]: value } : l));
  }

  function reset() {
    if (base) {
      setLevers(base.defaultLevers);
      push('info', 'Levers reset', 'Back to the default scenario derived from the measured baseline.');
    }
  }

  const header = (
    <PageHeader
      title="Policy simulator"
      engine="Scenario engine · measured baseline, published elasticities"
      subtitle="Every baseline number below is computed from the ingested tables, and every conversion between a lever and an outcome is an explicit assumption with a stated source. Nothing here is a black box — move a lever and the formulas re-evaluate."
      actions={
        <button type="button" className="btn" onClick={reset} data-testid="sim-reset">
          <SlidersHorizontal size={14} aria-hidden /> Reset to default scenario
        </button>
      }
    />
  );

  if (baseLoading && !base) {
    return (
      <div className="space-y-4" data-testid="simulate-page">
        {header}
        <SkeletonCards count={4} />
        <SkeletonChart height={300} />
      </div>
    );
  }
  if (baseError || !base) {
    return (
      <div className="space-y-4" data-testid="simulate-page">
        {header}
        <ErrorState err={baseError} onRetry={reloadBase} what="the simulator baseline" />
      </div>
    );
  }

  const outputs = result?.outputs ?? base.outputs;
  const chartOutputs = outputs.filter((o) => Array.isArray(o.years) && o.years.length > 0);

  return (
    <div className="space-y-4" data-testid="simulate-page">
      {header}

      {error ? <ErrorState err={error} what="the scenario" /> : null}

      <Card
        title="Headline"
        hint={`Horizon ${fmtCount(result?.horizonYears ?? base.horizonYears)} years${busy ? ' · recomputing…' : ''}`}
        testid="card-headline"
      >
        <p className="text-[0.95rem] font-semibold leading-relaxed text-ink" data-testid="sim-headline">
          {result ? prettifyMoney(result.headline) : 'Move a lever to generate a scenario against the measured baseline.'}
        </p>
        {result ? (
          <p className="mt-2 text-2xs text-faint">
            Reallocating {fmtPct(result.levers.budgetReallocationPct)} of the measured {fmtCr(result.baseline['idleCapitalCr'] ?? 0)} of idle
            capital across {fmtCount(result.baseline['districts'] ?? 0)} districts.
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.85fr_1.4fr]">
        <Card title="Levers" hint="Each change re-runs the scenario against the live baseline" testid="card-levers">
          <div className="space-y-4">
            {LEVERS.map((l) => (
              <div key={l.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <label className="label mb-0 truncate" htmlFor={`lever-${l.key}`} title={l.label}>
                    {l.label}
                  </label>
                  <span className="num shrink-0 text-sm font-bold text-teal" data-testid={`lever-value-${l.key}`}>
                    {l.unit === '₹ cr' ? fmtCr(levers?.[l.key] ?? 0) : `${fmtCount(levers?.[l.key] ?? 0)}${l.unit === '%' ? '%' : ` ${l.unit}`}`}
                  </span>
                </div>
                <input
                  id={`lever-${l.key}`}
                  type="range"
                  min={l.min}
                  max={l.max}
                  step={l.step}
                  value={levers?.[l.key] ?? 0}
                  onChange={(e) => set(l.key, Number(e.target.value))}
                  className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-teal"
                  data-testid={`lever-${l.key}`}
                />
                <p className="mt-1 text-2xs leading-relaxed text-faint">{l.note}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {outputs.slice(0, 6).map((o) => {
              const last = o.years?.[o.years.length - 1]?.value ?? o.baseline ?? 0;
              const first = o.baseline ?? 0;
              return (
                <Kpi
                  key={o.key}
                  label={o.label}
                  value={`${fmtNum(last, 2)} ${o.unit}`}
                  detail={`baseline ${fmtNum(first, 2)} ${o.unit} → year ${o.years?.length ?? 0}`}
                  tone={last > first ? 'saffron' : 'teal'}
                  testid={`sim-output-${o.key}`}
                />
              );
            })}
          </div>

          <Card title="Trajectories" hint="Modelled value per year for every output that has a time path" testid="card-trajectories">
            <TrendChart
              data={Array.from({ length: result?.horizonYears ?? base.horizonYears }, (_, i) => {
                const row: SeriesPoint = { label: `Year ${i + 1}` };
                chartOutputs.slice(0, 4).forEach((o) => {
                  row[o.key] = o.years?.[i]?.value ?? 0;
                });
                return row;
              })}
              series={chartOutputs.slice(0, 4).map((o, i) => ({ key: o.key, name: o.label.length > 38 ? `${o.label.slice(0, 36)}…` : o.label, colorIndex: i }))}
              height={300}
              testid="chart-trajectories"
            />
            <Caveat>
              Outputs are modelled, not measured. They are only as good as the elasticities below, all of which are Team CivicNexus estimates
              benchmarked to published unit costs — they are not official Government of India projections.
            </Caveat>
          </Card>
        </div>
      </div>

      <Card title="Every output, with its formula" hint="Read the interpretation alongside the number" testid="card-outputs">
        <div className="space-y-3">
          {outputs.map((o) => (
            <article key={o.key} className="min-w-0 rounded-lg border border-line bg-raised p-3" data-testid={`output-${o.key}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[0.85rem] font-bold text-ink">{o.label}</h3>
                <span className="num text-sm font-extrabold text-teal">
                  {fmtNum(o.years?.[o.years.length - 1]?.value ?? o.baseline ?? 0, 2)} {o.unit}
                </span>
              </div>
              {o.years ? (
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {o.years.map((y) => (
                    <span key={y.year} className="chip">
                      year {y.year} <span className="font-bold">{fmtNum(y.value, 2)}</span>
                    </span>
                  ))}
                </p>
              ) : null}
              {o.interpretation ? <p className="mt-1.5 text-2xs leading-relaxed text-muted">{prettifyMoney(o.interpretation)}</p> : null}
              <div className="mt-2">
                <Formula>{o.formula}</Formula>
              </div>
            </article>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Assumptions" hint="Twelve published constants — change your mind about one and you can recompute by hand" testid="card-assumptions" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-assumptions"
              rows={result?.assumptions ?? base.assumptions}
              rowKey={(a) => a.key}
              maxHeight="24rem"
              columns={[
                { key: 'label', header: 'Assumption', render: (a) => <span className="block max-w-[15rem] text-[0.78rem] font-semibold leading-snug text-ink">{a.label}</span> },
                { key: 'value', header: 'Value', align: 'right', render: (a) => <span className="font-bold text-teal">{fmtNum(a.value, 3)}</span> },
                { key: 'unit', header: 'Unit', render: (a) => <span className="text-muted">{a.unit}</span> },
                { key: 'source', header: 'Source', render: (a) => <span className="block max-w-[16rem] text-2xs leading-relaxed text-faint" title={a.source}>{a.source}</span> },
              ]}
            />
          </div>
        </Card>

        <Card title="Measured baseline" hint="Straight from the ingested tables — the starting point for every scenario" testid="card-baseline">
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(result?.baseline ?? base.baseline).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line/50 pb-1.5">
                <span className="truncate text-2xs text-faint" title={humanise(k)}>
                  {humanise(k)}
                </span>
                <span className="num shrink-0 text-[0.8rem] font-bold text-ink">
                  {/Cr$/.test(k) ? fmtCr(v) : /Pct$/.test(k) ? fmtPct(v) : fmtCount(v)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
