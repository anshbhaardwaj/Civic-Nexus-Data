import { useState } from 'react';
import { Coins } from 'lucide-react';
import { RankedBars, TrendChart } from '../components/charts';
import { Caveat, ErrorState, SkeletonCards, SkeletonChart } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, KeyValues, Meter, PageHeader, RunButton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { fmtCount, fmtCr, fmtNum, fmtPct } from '../lib/format';
import type { OptimiseResponse } from '../lib/types';

export default function Funds() {
  const { token } = useAuth();
  const [budget, setBudget] = useState<string>('');

  const { data, error, loading, run } = useAutoRun<OptimiseResponse>(
    () => api<OptimiseResponse>('/api/ai/optimise', { token, query: budget ? { budgetCr: Number(budget) } : {} }),
    `optimise:${budget}`,
  );

  const header = (
    <PageHeader
      title="Fund optimiser"
      engine="AI-7 · 0/1 knapsack dynamic programming"
      subtitle="Given a budget envelope, the optimiser picks the subset of policy cards that maximises total impact score. It is exact dynamic programming — not a greedy ratio sort — so it will skip a high-ratio item when a different combination fits the envelope better."
      actions={
        <>
          <label className="sr-only" htmlFor="budget">
            Budget in crore
          </label>
          <input
            id="budget"
            className="input w-40 py-1.5 text-2xs"
            inputMode="numeric"
            placeholder="budget (₹ cr)"
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))}
            data-testid="funds-budget"
          />
          <RunButton onClick={run} loading={loading} label={budget ? 'Re-optimise' : 'Re-run'} testid="funds-rerun" />
        </>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="space-y-4" data-testid="funds-page">
        {header}
        <SkeletonCards count={4} />
        <SkeletonChart height={300} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-4" data-testid="funds-page">
        {header}
        <ErrorState err={error} onRetry={run} what="the optimiser" />
      </div>
    );
  }

  const pareto = data.paretoFrontier.map((p) => ({ label: fmtCr(p.budgetCr), impact: p.totalImpact, items: p.items }));

  return (
    <div className="space-y-4" data-testid="funds-page">
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Budget envelope" value={fmtCr(data.budgetCr)} detail={budget ? 'entered by you' : 'derived from measured idle capital'} tone="saffron" testid="kpi-budget" />
        <Kpi label="Committed" value={fmtCr(data.totalCostCr)} detail={`${fmtCount(data.chosen.length)} of ${fmtCount(data.candidates)} candidate interventions`} testid="kpi-committed" />
        <Kpi label="Total impact" value={fmtNum(data.totalImpact, 1)} detail={`${fmtNum(data.impactPerCr, 3)} impact per crore committed`} tone="teal" testid="kpi-impact" />
        <Kpi label="Beneficiaries reached" value={fmtCount(data.beneficiaries)} detail="sum over chosen cards, not de-duplicated" testid="kpi-beneficiaries" />
      </div>

      <Card title="Envelope utilisation" hint="A 0/1 knapsack rarely fills the envelope exactly — the residue is the cost of indivisible projects" testid="card-utilisation">
        <div className="space-y-2">
          <Meter pct={data.utilisationPct} tone="saffron" />
          <p className="text-[0.8rem] leading-relaxed text-muted">
            {fmtPct(data.utilisationPct)} of {fmtCr(data.budgetCr)} is committed, leaving {fmtCr(data.budgetCr - data.totalCostCr)} unallocated
            because no remaining card fits the residue.
          </p>
          <p className="text-2xs leading-relaxed text-faint" title={data.budgetSource}>
            Budget derivation — measured idle capital across schemes is {fmtCr(data.idleCapitalCr)}; the default envelope is 35% of that, capped at
            60% of the total ask from all cards, with a floor of {fmtCr(50)}. Cost granularity is {fmtCr(data.granularityCr)} per DP cell.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.25fr_1fr]">
        <Card title="Chosen portfolio" hint="Sorted by impact score; every row is a policy card with published evidence" testid="card-chosen" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-chosen"
              rows={data.chosen}
              rowKey={(c) => c.code}
              maxHeight="26rem"
              columns={[
                { key: 'code', header: 'Code', render: (c) => <span className="font-mono text-2xs text-faint">{c.code}</span> },
                {
                  key: 'title',
                  header: 'Intervention',
                  render: (c) => (
                    <span className="block max-w-[18rem] truncate font-semibold text-ink" title={c.title}>
                      {c.title}
                      <span className="block truncate text-2xs font-normal text-faint">
                        {c.department}
                        {c.district ? ` · ${c.district}` : ''}
                      </span>
                    </span>
                  ),
                },
                { key: 'impactScore', header: 'Impact', align: 'right', render: (c) => <span className="font-bold text-teal">{fmtNum(c.impactScore, 1)}</span> },
                { key: 'costCr', header: 'Cost', align: 'right', render: (c) => fmtCr(c.costCr) },
                { key: 'impactPerCr', header: 'Impact / cr', align: 'right', render: (c) => fmtNum(c.impactPerCr, 3) },
                { key: 'beneficiaries', header: 'Beneficiaries', align: 'right', render: (c) => fmtCount(c.beneficiaries) },
              ]}
            />
          </div>
        </Card>

        <Card title="Budget sweep (Pareto frontier)" hint="Total impact achievable at each budget level, re-solving the knapsack each time" testid="card-pareto">
          <TrendChart
            data={pareto}
            series={[{ key: 'impact', name: 'Total impact', colorIndex: 0 }]}
            height={280}
            unit="impact score"
            testid="chart-pareto"
          />
          <Caveat>
            Impact rises steeply at first and then flattens — the marginal impact per crore falls as the cheap, high-scoring interventions are
            exhausted. That flattening point is the argument for capping the envelope rather than spending everything.
          </Caveat>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Rejected candidates" hint="Every exclusion carries the optimiser's own reason" testid="card-rejected" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-rejected"
              rows={data.rejected}
              rowKey={(c) => c.code}
              maxHeight="22rem"
              columns={[
                {
                  key: 'title',
                  header: 'Intervention',
                  render: (c) => (
                    <span className="block max-w-[16rem] truncate font-semibold text-ink" title={c.title}>
                      {c.title}
                      <span className="block font-mono text-2xs font-normal text-faint">{c.code}</span>
                    </span>
                  ),
                },
                { key: 'impactScore', header: 'Impact', align: 'right', render: (c) => fmtNum(c.impactScore, 1) },
                { key: 'costCr', header: 'Cost', align: 'right', render: (c) => fmtCr(c.costCr) },
                {
                  key: 'reason',
                  header: 'Why excluded',
                  render: (c) => (
                    <span className="block max-w-[18rem] text-2xs leading-relaxed text-muted" title={c.reason}>
                      {c.reason}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </Card>

        <Card title="How the portfolio was computed" hint="All four formulas the engine used" testid="card-formulas">
          <div className="space-y-2">
            {Object.entries(data.formulas).map(([k, v]) => (
              <Formula key={k} label={k}>
                {v}
              </Formula>
            ))}
          </div>
          <div className="mt-4">
            <KeyValues
              cols={2}
              items={[
                { k: 'Candidates considered', v: fmtCount(data.candidates) },
                { k: 'Items chosen', v: fmtCount(data.chosen.length) },
                { k: 'Cost granularity', v: `${fmtCr(data.granularityCr)} per DP cell` },
                { k: 'Frontier points', v: fmtCount(data.paretoFrontier.length) },
              ]}
            />
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
            <Coins size={12} aria-hidden /> Costs are rounded to the granularity above before the DP table is filled, which is why utilisation is
            not exactly 100%.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.paretoFrontier.slice(0, 8).map((p) => (
              <Badge key={p.budgetCr} kind="low">
                {fmtCr(p.budgetCr)} → {fmtNum(p.totalImpact, 0)} impact / {fmtCount(p.items)} items
              </Badge>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Value for money of the chosen items" hint="Impact score per crore committed, top 12 by ratio" testid="card-value-for-money">
        <RankedBars
          data={[...data.chosen].sort((a, b) => b.impactPerCr - a.impactPerCr).slice(0, 12).map((c) => ({ label: c.code, value: c.impactPerCr }))}
          unit="impact per crore"
          height={Math.max(200, Math.min(12, data.chosen.length) * 28)}
          testid="chart-impact-per-cr"
          colorIndex={2}
        />
      </Card>
    </div>
  );
}
