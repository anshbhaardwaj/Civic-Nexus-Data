import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ScanLine, X } from 'lucide-react';
import { RankedBars } from '../components/charts';
import { EmptyState, ErrorState, SkeletonCards, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, PageHeader, RunButton } from '../components/ui';
import { api, errMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { clip, fmtCount, fmtDateTime, fmtNum, fmtSigma, metricUnit } from '../lib/format';
import type { Anomaly, AnomalySummary } from '../lib/types';

interface ListResponse {
  total: number;
  limit: number;
  offset: number;
  anomalies: Anomaly[];
}

const SEV_COLOURS: Record<string, string> = { critical: '#F87171', high: '#FB923C', medium: '#2DD4BF', low: '#94A3B8' };
const SEVERITIES = ['', 'critical', 'high', 'medium', 'low'];
const STATUSES = ['', 'open', 'acknowledged', 'dismissed'];

export default function Anomalies() {
  const { token, can } = useAuth();
  const { datasets } = useDatasets();
  const { push } = useToast();
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('open');
  const [datasetId, setDatasetId] = useState('');
  const [selected, setSelected] = useState<Anomaly | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const key = `anomalies:${severity}:${status}:${datasetId}`;
  const { data, error, loading, run } = useAutoRun<{ list: ListResponse; summary: AnomalySummary }>(
    async () => {
      const query: Record<string, string | number> = { limit: 100 };
      if (severity) query['severity'] = severity;
      if (status) query['status'] = status;
      if (datasetId) query['datasetId'] = datasetId;
      const [list, summary] = await Promise.all([
        api<ListResponse>('/api/anomalies', { token, query }),
        api<AnomalySummary>('/api/anomalies/summary', { token }),
      ]);
      return { list, summary };
    },
    key,
  );

  const rows = data?.list.anomalies ?? [];
  const active = useMemo(() => selected ?? rows[0] ?? null, [selected, rows]);

  async function act(a: Anomaly, action: 'ack' | 'dismiss') {
    setBusy(a.id);
    try {
      await api(`/api/anomalies/${a.id}/${action}`, { token, method: 'POST', body: { note: `${action === 'ack' ? 'Acknowledged' : 'Dismissed'} from the anomaly register` } });
      push('success', `Anomaly #${a.id} ${action === 'ack' ? 'acknowledged' : 'dismissed'}`, `${a.column_name} · ${a.entity} · ${a.period} — the state change is now an audit-chain entry.`);
      setSelected(null);
      await run();
    } catch (err) {
      push('error', 'Could not update the anomaly', errMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Anomaly register" subtitle="Scanning the AI-1 register…" />
        <SkeletonCards count={4} />
        <SkeletonTable rows={10} cols={7} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Anomaly register" />
        <ErrorState err={error} onRetry={run} what="the anomaly register" />
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="space-y-4" data-testid="anomalies-page">
      <PageHeader
        title="Anomaly register"
        subtitle="AI-1 uses a robust MAD baseline per entity group as the primary detector at 3.5σ, then corroborates each candidate with a z-score test and Tukey's IQR rule. Severity rises with detector agreement and deviation size."
        engine="AI-1 · statistical anomaly detection"
        actions={<RunButton onClick={run} loading={loading} testid="anomalies-rerun" />}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Findings in register" value={fmtCount(s.total)} detail={`${fmtCount(s.byDataset.length)} datasets affected`} testid="kpi-total" />
        <Kpi label="Critical" value={fmtCount(s.bySeverity.find((x) => x.severity === 'critical')?.n ?? 0)} detail="3/3 detectors agree, large deviation" tone="danger" testid="kpi-critical" />
        <Kpi label="Open" value={fmtCount(s.byStatus.find((x) => x.status === 'open')?.n ?? 0)} detail="not yet triaged" tone="saffron" testid="kpi-open" />
        <Kpi label="Largest deviation" value={fmtSigma(Math.max(...s.byDataset.map((d) => d.max_sigma), 0))} detail="σ measured against the MAD baseline" tone="teal" testid="kpi-max-sigma" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="By dataset" hint="Count and the largest deviation observed" testid="card-by-dataset">
          <RankedBars
            data={s.byDataset.map((d) => ({ label: d.dataset_slug, value: d.n }))}
            unit="anomalies"
            height={Math.max(180, s.byDataset.length * 30)}
            testid="chart-by-dataset"
          />
        </Card>
        <Card title="By severity" hint={s.method} testid="card-by-severity">
          <RankedBars
            data={s.bySeverity.map((d) => ({ label: d.severity, value: d.n }))}
            unit="anomalies"
            height={Math.max(150, s.bySeverity.length * 38)}
            testid="chart-by-severity"
            colorBy={(row) => SEV_COLOURS[String(row['label'])] ?? '#2DD4BF'}
          />
        </Card>
      </div>

      <Card
        title="Findings"
        hint={`${fmtCount(data.list.total)} match the current filters · showing up to ${fmtCount(data.list.limit)}`}
        testid="card-findings"
        right={
          <span className="flex flex-wrap items-center gap-1.5">
            <select className="input py-1 text-2xs" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} data-testid="filter-dataset" aria-label="Filter by dataset">
              <option value="">All datasets</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select className="input py-1 text-2xs" value={severity} onChange={(e) => setSeverity(e.target.value)} data-testid="filter-severity" aria-label="Filter by severity">
              {SEVERITIES.map((x) => (
                <option key={x || 'all'} value={x}>
                  {x || 'All severities'}
                </option>
              ))}
            </select>
            <select className="input py-1 text-2xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="filter-status" aria-label="Filter by status">
              {STATUSES.map((x) => (
                <option key={x || 'all'} value={x}>
                  {x || 'All statuses'}
                </option>
              ))}
            </select>
          </span>
        }
        pad={false}
      >
        <div className="p-3">
          {rows.length === 0 ? (
            <EmptyState title="No findings match these filters">
              <p>
                The register holds {fmtCount(s.total)} findings in total. Widen the severity or status filter, or run a live telemetry tick from
                the dashboard to inject a fresh spike.
              </p>
            </EmptyState>
          ) : (
            <DataTable
              testid="table-anomalies"
              rows={rows}
              rowKey={(a) => a.id}
              maxHeight="30rem"
              onRowClick={(a) => setSelected(a)}
              rowTestid={(a) => `anomaly-row-${a.id}`}
              columns={[
                { key: 'severity', header: 'Severity', render: (a) => <Badge kind={a.severity} testid={`sev-${a.id}`}>{a.severity}</Badge> },
                {
                  key: 'what',
                  header: 'Metric · entity · period',
                  render: (a) => (
                    <span className="block max-w-[17rem] truncate" title={`${a.column_name} · ${a.entity} · ${a.period}`}>
                      <span className="font-semibold text-ink">{a.column_name}</span>
                      <span className="block truncate text-2xs text-faint">
                        {a.entity} · {a.period} · {a.dataset_slug}
                      </span>
                    </span>
                  ),
                },
                { key: 'value', header: 'Observed', align: 'right', render: (a) => `${fmtNum(a.value, 2)}${metricUnit(a.column_name)}` },
                {
                  key: 'band',
                  header: 'Expected band',
                  align: 'right',
                  render: (a) => (
                    <span className="text-muted">
                      {fmtNum(a.expected_low, 2)} – {fmtNum(a.expected_high, 2)}
                    </span>
                  ),
                },
                { key: 'sigma', header: 'Deviation', align: 'right', render: (a) => fmtSigma(a.sigma) },
                { key: 'methods_agree', header: 'Detectors', align: 'right', render: (a) => `${a.methods_agree}/3` },
                { key: 'status', header: 'Status', render: (a) => <Badge kind={a.status}>{a.status}</Badge> },
              ]}
            />
          )}
        </div>
      </Card>

      {active ? (
        <Card title={`Why #${active.id} was flagged`} hint="Server-generated explanation, verbatim" testid="card-explanation">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="min-w-0 space-y-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge kind={active.severity}>{active.severity}</Badge>
                <Badge kind={active.status}>{active.status}</Badge>
                <span className="chip">{active.method}</span>
                <span className="chip">{active.methods_agree}/3 detectors agree</span>
              </p>
              <p className="text-[0.85rem] leading-relaxed text-muted" data-testid="anomaly-explanation">
                {active.explanation}
              </p>
              <Formula>score = deviation ÷ scaled MAD, weighted by detector agreement → {fmtNum(active.score, 3)}</Formula>
              <p className="text-2xs text-faint">
                Detected {fmtDateTime(active.detected_at)} · source row #{active.source_row_id} of {active.dataset_slug}
              </p>
              {can('anomalies.write') ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => void act(active, 'ack')} disabled={busy === active.id || active.status === 'acknowledged'} data-testid="ack-button">
                    <Check size={14} aria-hidden /> Acknowledge
                  </button>
                  <button type="button" className="btn" onClick={() => void act(active, 'dismiss')} disabled={busy === active.id || active.status === 'dismissed'} data-testid="dismiss-button">
                    <X size={14} aria-hidden /> Dismiss
                  </button>
                </div>
              ) : (
                <p className="flex items-start gap-1.5 text-2xs text-faint" data-testid="anomalies-write-denied">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-saffron" aria-hidden />
                  Your role has read access to the register; acknowledging or dismissing a finding requires the anomalies.write permission
                  (analyst or director).
                </p>
              )}
            </div>
            <dl className="space-y-2.5 rounded-lg border border-line bg-raised p-3">
              {[
                { k: 'Observed value', v: `${fmtNum(active.value, 3)}${metricUnit(active.column_name)}` },
                { k: 'Expected low', v: fmtNum(active.expected_low, 3) },
                { k: 'Expected high', v: fmtNum(active.expected_high, 3) },
                { k: 'Deviation from band', v: fmtNum(active.deviation, 3) },
                { k: 'Deviation in σ', v: fmtSigma(active.sigma) },
                { k: 'Anomaly score', v: fmtNum(active.score, 3) },
                { k: 'Entity group', v: active.entity ?? '—' },
                { k: 'Period', v: active.period ?? '—' },
              ].map((x) => (
                <div key={x.k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-2xs text-faint">{x.k}</dt>
                  <dd className="num text-[0.8rem] font-bold text-ink">{clip(x.v, 26)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
            <ScanLine size={12} aria-hidden /> Select any row above to read its own explanation.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
