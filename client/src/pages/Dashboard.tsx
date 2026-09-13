import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, Coins, Database, ShieldCheck, Zap } from 'lucide-react';
import { RankedBars } from '../components/charts';
import { ErrorState, SkeletonCards, SkeletonChart, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Kpi, Meter, PageHeader, RunButton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { fmtCount, fmtCr, fmtDateTime, fmtNum, fmtPct } from '../lib/format';
import { useDatasets } from '../lib/datasets';
import type { DashboardResponse, LiveTickResponse } from '../lib/types';

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];

export default function Dashboard() {
  const { token, can, user } = useAuth();
  const { reload } = useDatasets();
  const { push } = useToast();
  const { data, error, loading, run } = useAutoRun<DashboardResponse>(
    () => api<DashboardResponse>('/api/dashboard', { token }),
    'dashboard',
  );

  async function tick() {
    try {
      const res = await api<LiveTickResponse>('/api/live/tick', { token, method: 'POST', body: { spikeProbability: 0.35 } });
      const scan = (res['anomalyScan'] ?? {}) as { detected?: number; persisted?: number };
      push(
        'success',
        `Live telemetry appended: ${fmtCount(Number(res['rowsAppended'] ?? 0))} rows`,
        `${String((res['dataset'] as { name?: string } | undefined)?.name ?? 'dataset')} · AI-1 rescan detected ${fmtCount(
          Number(scan.detected ?? 0),
        )} anomalies · rows ${fmtCount(Number(res['rowCountBefore'] ?? 0))} → ${fmtCount(Number(res['rowCountAfter'] ?? 0))}`,
      );
      await Promise.all([run(), reload()]);
    } catch (err) {
      push('error', 'Live tick failed', err instanceof Error ? err.message : String(err));
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Command dashboard" subtitle="Loading the single-call landing payload…" />
        <SkeletonCards count={5} />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <SkeletonChart />
          <SkeletonTable rows={5} cols={4} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Command dashboard" />
        <ErrorState err={error} onRetry={run} what="the dashboard" />
      </div>
    );
  }

  const k = data.kpis;
  const sev = [...data.anomaliesBySeverity].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const totalSev = sev.reduce((s, x) => s + x.n, 0) || 1;

  return (
    <div className="space-y-4" data-testid="dashboard-page">
      <PageHeader
        title="Command dashboard"
        subtitle={`Live state of ${fmtCount(k.datasets)} public datasets, ${fmtCount(k.rows)} ingested rows and every engine output — one API call, no cached fixtures.`}
        actions={
          <>
            {can('datasets.ingest') ? (
              <button type="button" className="btn-accent" onClick={() => void tick()} data-testid="live-tick-button">
                <Zap size={14} aria-hidden /> Run live tick
              </button>
            ) : null}
            <RunButton onClick={() => void run()} loading={loading} label="Refresh" testid="dashboard-refresh" />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Idle capital identified" value={fmtCr(k.idleCapitalCr)} detail="sum(released − spent) across schemes" tone="saffron" testid="kpi-idle-capital" />
        <Kpi label="Scheme utilisation" value={fmtPct(k.utilisationPct)} detail="spent ÷ released, all schemes" tone="teal" testid="kpi-utilisation" />
        <Kpi label="Open anomalies" value={fmtCount(k.anomalies)} detail="AI-1 MAD + z-score + IQR agreement" tone="danger" testid="kpi-anomalies" />
        <Kpi label="Policy cards" value={fmtCount(k.policyCards)} detail="AI-6 MCDA, 6 weighted criteria" testid="kpi-policy-cards" />
        <Kpi label="Distressed NH bridges" value={fmtCount(k.distressedBridges)} detail="IBMS rating below 75" tone="danger" testid="kpi-bridges" />
        <Kpi label="Mean ambulance response" value={`${fmtNum(k.meanAmbulanceResponseMin, 2)} min`} detail="all districts, latest 12 periods" testid="kpi-ambulance" />
        <Kpi label="Functional tap connections" value={fmtPct(k.functionalTapPct)} detail="Jal Jeevan Mission households" tone="teal" testid="kpi-tap" />
        <Kpi label="Grievance closure" value={`${fmtNum(k.grievanceDaysToClose, 1)} days`} detail="mean days to close, all departments" testid="kpi-grievances" />
        <Kpi label="Rows under management" value={fmtCount(k.rows)} detail={`${fmtCount(k.datasets)} datasets, 10-step lineage each`} testid="kpi-rows" />
        <Kpi
          label="Audit chain"
          value={data.auditChain.valid ? 'Verified' : 'Broken'}
          detail={`${fmtCount(data.auditChain.entries)} entries · head ${data.auditChain.headHash.slice(0, 10)}…`}
          tone={data.auditChain.valid ? 'ok' : 'danger'}
          testid="kpi-audit"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card
          title="Anomalies by severity"
          hint={`AI-1 register · ${fmtCount(totalSev)} findings across ${fmtCount(data.datasets.length)} datasets`}
          testid="card-anomalies-severity"
          right={
            <Link to="/anomalies" className="chip hover:border-teal/60 hover:text-teal" data-testid="link-anomalies">
              Register <ArrowUpRight size={11} aria-hidden />
            </Link>
          }
        >
          <RankedBars
            data={sev.map((s) => ({ label: s.severity, value: s.n }))}
            unit="anomalies"
            height={190}
            testid="chart-severity"
            colorBy={(row) =>
              ({ critical: '#F87171', high: '#FB923C', medium: '#2DD4BF', low: '#94A3B8' })[String(row['label'])] ?? '#2DD4BF'
            }
          />
        </Card>

        <Card
          title="Portfolio under the fund optimiser"
          hint="AI-7 0/1 knapsack over MCDA cards"
          testid="card-portfolio"
          right={
            <Link to="/funds" className="chip hover:border-teal/60 hover:text-teal" data-testid="link-funds">
              Optimiser <ArrowUpRight size={11} aria-hidden />
            </Link>
          }
        >
          <dl className="space-y-3">
            <div>
              <dt className="label">Budget envelope</dt>
              <dd className="num text-xl font-extrabold text-saffron">{fmtCr(data.portfolio.budgetCr)}</dd>
            </div>
            <div>
              <dt className="label">Committed to {fmtCount(data.portfolio.items)} interventions</dt>
              <dd className="num text-lg font-bold text-ink">{fmtCr(data.portfolio.totalCostCr)}</dd>
              <dd className="mt-2">
                <Meter pct={data.portfolio.utilisationPct} />
                <p className="mt-1 text-2xs text-faint">{fmtPct(data.portfolio.utilisationPct)} of the envelope committed</p>
              </dd>
            </div>
            <div>
              <dt className="label">Total impact score</dt>
              <dd className="num text-lg font-bold text-teal">{fmtNum(data.portfolio.totalImpact, 2)}</dd>
            </div>
          </dl>
        </Card>

        <Card
          title="Top MCDA policy cards"
          hint="AI-6 impact score 0–100, contributions reconcile exactly"
          testid="card-top-cards"
          right={
            <Link to="/policy-cards" className="chip hover:border-teal/60 hover:text-teal" data-testid="link-policy-cards">
              All cards <ArrowUpRight size={11} aria-hidden />
            </Link>
          }
        >
          <ul className="space-y-2.5">
            {data.topPolicyCards.map((c) => (
              <li key={c.code} className="min-w-0 border-b border-line/60 pb-2.5 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[0.8rem] font-semibold leading-snug text-ink" title={c.title}>
                    {c.title}
                  </p>
                  <span className="num shrink-0 text-sm font-extrabold text-teal">{fmtNum(c.impactScore, 1)}</span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
                  <span className="font-mono">{c.code}</span>
                  <span aria-hidden>·</span>
                  <span>{c.sector}</span>
                  <span aria-hidden>·</span>
                  <span className="num font-semibold text-saffron">{fmtCr(c.costCr)}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title="Dataset inventory"
          hint="Every row arrived through the 10-step pipeline; quality score = 100 − reject share − null share"
          testid="card-inventory"
          pad={false}
          right={
            <Link to="/datasets" className="chip hover:border-teal/60 hover:text-teal" data-testid="link-datasets">
              <Database size={11} aria-hidden /> Catalogue
            </Link>
          }
        >
          <div className="p-3">
            <DataTable
              testid="table-inventory"
              rows={data.datasets}
              rowKey={(d) => d.slug}
              maxHeight="22rem"
              columns={[
                {
                  key: 'name',
                  header: 'Dataset',
                  render: (d) => (
                    <Link to={`/datasets/${d.slug}`} className="font-semibold text-ink hover:text-teal" title={d.name}>
                      <span className="block max-w-[15rem] truncate">{d.name}</span>
                      <span className="block text-2xs font-normal text-faint">{d.domain}</span>
                    </Link>
                  ),
                },
                { key: 'rows', header: 'Rows', align: 'right', render: (d) => fmtCount(d.rows) },
                { key: 'columns', header: 'Cols', align: 'right', render: (d) => fmtCount(d.columns) },
                {
                  key: 'piiColumns',
                  header: 'PII',
                  align: 'right',
                  render: (d) => (d.piiColumns > 0 ? <Badge kind="critical">{d.piiColumns} masked</Badge> : <span className="text-faint">none</span>),
                },
                { key: 'qualityScore', header: 'Quality', align: 'right', render: (d) => fmtPct(d.qualityScore) },
              ]}
            />
          </div>
        </Card>

        <Card
          title="Audit chain — latest entries"
          hint="SHA-256(prevHash|seq|ts|actor|action|entity|payloadHash)"
          testid="card-recent-audit"
          right={
            can('audit.read') ? (
              <Link to="/audit" className="chip hover:border-teal/60 hover:text-teal" data-testid="link-audit">
                <ShieldCheck size={11} aria-hidden /> Verify
              </Link>
            ) : null
          }
        >
          <ul className="space-y-2" data-testid="list-recent-audit">
            {data.recentAudit.map((e) => (
              <li key={e.id} className="flex min-w-0 items-start gap-2.5 border-b border-line/60 pb-2 last:border-0 last:pb-0">
                <Activity size={13} className="mt-0.5 shrink-0 text-teal" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8rem] font-semibold text-ink" title={`${e.action} · ${e.entity}`}>
                    {e.action}
                  </p>
                  <p className="truncate text-2xs text-faint">
                    {e.actor} · {e.entity}
                  </p>
                </div>
                <span className="num shrink-0 text-2xs text-faint">{fmtDateTime(e.ts).split(', ')[1]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
            <Coins size={12} aria-hidden /> Signed in as {user?.email} · every mutation you make is appended here.
          </p>
        </Card>
      </div>
    </div>
  );
}
