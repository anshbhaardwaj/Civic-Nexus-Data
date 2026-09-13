import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCcw, Target } from 'lucide-react';
import { RankedBars } from '../components/charts';
import { Caveat, EmptyState, ErrorState, SkeletonCards, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, PageHeader, RunButton } from '../components/ui';
import { api, errMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { fmtCount, fmtCr, fmtNum, fmtPct, humanise } from '../lib/format';
import type { PolicyCard, PolicyCardsResponse } from '../lib/types';

export default function PolicyCards() {
  const { token, can } = useAuth();
  const { push } = useToast();
  const [sector, setSector] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, loading, run } = useAutoRun<PolicyCardsResponse>(
    () => api<PolicyCardsResponse>('/api/ai/policy-cards', { token, query: sector ? { sector, limit: 60 } : { limit: 60 } }),
    `policy:${sector}`,
  );

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await api<{ regenerated?: number; count?: number }>('/api/ai/policy-cards/refresh', { token, method: 'POST' });
      push('success', 'Policy cards regenerated', `${fmtCount(Number(res.regenerated ?? res.count ?? 0))} cards rebuilt from the current evidence rows.`);
      await run();
    } catch (err) {
      push('error', 'Refresh failed', errMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="MCDA policy cards" subtitle="Scoring interventions…" />
        <SkeletonCards count={4} />
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="MCDA policy cards" />
        <ErrorState err={error} onRetry={run} what="the policy cards" />
      </div>
    );
  }

  const cards = data.cards;
  const active: PolicyCard | undefined = cards.find((c) => c.code === pick) ?? cards[0];
  const contributionSum = active ? active.criteria.reduce((s, c) => s + c.contribution, 0) : 0;

  return (
    <div className="space-y-4" data-testid="policy-cards-page">
      <PageHeader
        title="MCDA policy cards"
        engine="AI-6 · multi-criteria decision analysis"
        subtitle="Each candidate intervention is scored on six normalised criteria with published weights. The impact score is a weighted sum, so the contributions below always reconcile exactly to the headline number."
        actions={
          <>
            <select className="input py-1.5 text-2xs" value={sector} onChange={(e) => setSector(e.target.value)} data-testid="policy-sector" aria-label="Filter by sector">
              <option value="">All sectors</option>
              {data.sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {can('ai.run') ? (
              <button type="button" className="btn" onClick={() => void refresh()} disabled={refreshing} data-testid="policy-refresh">
                <RefreshCcw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden /> Regenerate
              </button>
            ) : null}
            <RunButton onClick={run} loading={loading} testid="policy-rerun" />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Cards scored" value={fmtCount(data.count)} detail={`${fmtCount(data.sectors.length)} sectors covered`} testid="kpi-cards" />
        <Kpi label="Highest impact score" value={fmtNum(cards[0]?.impactScore ?? 0, 1)} detail={cards[0]?.title ?? '—'} tone="teal" testid="kpi-top-score" />
        <Kpi label="Total cost of all cards" value={fmtCr(cards.reduce((s, c) => s + c.costCr, 0))} detail="sum of estimated intervention cost" tone="saffron" testid="kpi-total-cost" />
        <Kpi label="Beneficiaries addressed" value={fmtCount(cards.reduce((s, c) => s + c.beneficiaries, 0))} detail="union not de-duplicated across cards" testid="kpi-beneficiaries" />
      </div>

      <Card title="Criteria weights" hint={data.formula} testid="card-weights">
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.weights).map(([k, w]) => (
            <span key={k} className="chip" data-testid={`weight-${k}`}>
              <span className="text-faint">{humanise(k)}</span>
              <span className="font-bold text-teal">{fmtPct(w * 100, 0)}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card title="Ranked interventions" hint="Select a card to see its full score decomposition and evidence rows" testid="card-cards" pad={false}>
        <div className="p-3">
          {cards.length === 0 ? (
            <EmptyState title="No cards in this sector">
              <p>Clear the sector filter, or regenerate the cards so AI-6 rescans the current evidence rows.</p>
            </EmptyState>
          ) : (
            <DataTable
              testid="table-policy-cards"
              rows={cards}
              rowKey={(c) => c.code}
              maxHeight="28rem"
              onRowClick={(c) => setPick(c.code)}
              rowTestid={(c) => `policy-row-${c.code}`}
              columns={[
                { key: 'code', header: 'Code', render: (c) => <span className="font-mono text-2xs text-faint">{c.code}</span> },
                {
                  key: 'title',
                  header: 'Intervention',
                  render: (c) => (
                    <span className="block max-w-[20rem] truncate font-semibold text-ink" title={c.title}>
                      {c.title}
                      <span className="block truncate text-2xs font-normal text-faint">
                        {c.department}
                        {c.district ? ` · ${c.district}` : ''}
                      </span>
                    </span>
                  ),
                },
                { key: 'sector', header: 'Sector', render: (c) => <span className="chip">{c.sector}</span> },
                { key: 'impactScore', header: 'Impact', align: 'right', render: (c) => <span className="font-bold text-teal">{fmtNum(c.impactScore, 1)}</span> },
                { key: 'costCr', header: 'Cost', align: 'right', render: (c) => fmtCr(c.costCr) },
                { key: 'beneficiaries', header: 'Beneficiaries', align: 'right', render: (c) => fmtCount(c.beneficiaries) },
                {
                  key: 'sdgs',
                  header: 'SDGs',
                  render: (c) => (
                    <span className="flex flex-wrap gap-1">
                      {c.sdgs.map((s) => (
                        <span key={s} className="rounded border border-line px-1 text-2xs text-muted">
                          {s}
                        </span>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      {active ? (
        <Card title={`Score decomposition — ${active.code}`} hint={`${active.title} · ${active.department}`} testid="card-decomposition">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.15fr]">
            <div className="min-w-0 space-y-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge kind="medium">impact {fmtNum(active.impactScore, 1)}</Badge>
                <Badge kind="open">{fmtCr(active.costCr)}</Badge>
                <span className="chip">{fmtCount(active.beneficiaries)} beneficiaries</span>
                <span className="chip">{active.sector}</span>
              </p>
              <div>
                <p className="label">Recommended action</p>
                <p className="text-[0.85rem] font-semibold leading-relaxed text-ink" data-testid="policy-action">
                  {active.action}
                </p>
              </div>
              <div>
                <p className="label">Rationale</p>
                <p className="text-[0.8rem] leading-relaxed text-muted" data-testid="policy-rationale">
                  {active.rationale}
                </p>
              </div>
              <div>
                <p className="label">Evidence</p>
                <p className="text-[0.8rem] leading-relaxed text-muted">
                  {fmtCount(active.evidence.rowIds.length)} rows of{' '}
                  <Link to={`/datasets/${active.evidence.datasetSlug}`} className="font-semibold text-teal hover:underline" data-testid="policy-evidence-link">
                    {active.evidence.datasetSlug}
                  </Link>{' '}
                  · {humanise(active.evidence.metric)} measured {fmtNum(active.evidence.measured, 2)} against a target of{' '}
                  {fmtNum(active.evidence.target, 2)}.
                </p>
                <p className="mt-1 flex flex-wrap gap-1" data-testid="policy-evidence-rows">
                  {active.evidence.rowIds.slice(0, 12).map((r) => (
                    <span key={r} className="rounded border border-line px-1 font-mono text-2xs text-faint">
                      #{r}
                    </span>
                  ))}
                </p>
              </div>
              <RankedBars
                data={active.criteria.map((c) => ({ label: c.label, value: c.contribution }))}
                unit="score contribution"
                height={Math.max(180, active.criteria.length * 32)}
                testid="chart-contributions"
                colorIndex={1}
              />
            </div>

            <div className="min-w-0 space-y-3">
              <DataTable
                testid="table-criteria"
                rows={active.criteria}
                rowKey={(c) => c.key}
                maxHeight="22rem"
                columns={[
                  { key: 'label', header: 'Criterion', render: (c) => <span className="block max-w-[11rem] truncate font-semibold text-ink" title={c.label}>{c.label}</span> },
                  { key: 'weight', header: 'Weight', align: 'right', render: (c) => fmtPct(c.weight * 100, 0) },
                  { key: 'raw', header: 'Raw', align: 'right', render: (c) => fmtNum(c.raw, 2) },
                  { key: 'normalised', header: 'Normalised', align: 'right', render: (c) => fmtNum(c.normalised, 4) },
                  { key: 'contribution', header: 'Contribution', align: 'right', render: (c) => <span className="font-bold text-teal">{fmtNum(c.contribution, 3)}</span> },
                ]}
              />
              <p className="flex items-center gap-1.5 rounded-lg border border-teal/40 bg-teal/5 px-3 py-2 text-2xs text-teal" data-testid="reconciliation">
                <Target size={13} aria-hidden />
                Contributions sum to {fmtNum(contributionSum, 3)} — the published impact score is {fmtNum(active.impactScore, 3)}, so the
                decomposition reconciles to {fmtNum(Math.abs(contributionSum - active.impactScore), 4)} absolute difference.
              </p>
              <div className="space-y-2">
                {active.criteria.map((c) => (
                  <Formula key={c.key} label={c.label}>
                    {c.formula}
                  </Formula>
                ))}
              </div>
              <Caveat>
                Weights are a policy choice, not a fact. Changing them re-ranks the list; they are published here so a reviewer can disagree with
                the weighting rather than with a hidden model.
              </Caveat>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
