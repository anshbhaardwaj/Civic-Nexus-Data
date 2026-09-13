import { FileDown, ShieldCheck } from 'lucide-react';
import { Caveat, ErrorState, SkeletonCards, SkeletonText } from '../components/states';
import { Badge, Card, DataTable, Kpi, PageHeader, RunButton } from '../components/ui';
import { api, downloadUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { fmtCount, fmtCr, fmtDateTime, fmtNum, fmtPct, humanise, prettifyMoney } from '../lib/format';
import type { BriefResponse } from '../lib/types';

export default function Brief() {
  const { token, user } = useAuth();
  const { push } = useToast();
  const { data, error, loading, run } = useAutoRun<BriefResponse>(() => api<BriefResponse>('/api/brief/preview', { token }), 'brief');

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Executive brief" subtitle="Assembling the brief from every engine…" />
        <SkeletonCards count={6} />
        <Card title="Narrative">
          <SkeletonText lines={8} />
        </Card>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="Executive brief" />
        <ErrorState err={error} onRetry={run} what="the executive brief" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="brief-page">
      <PageHeader
        title="Executive brief"
        subtitle="A one-click cabinet-ready note assembled from the live tables and every engine output. The PDF is generated server-side with the same numbers you see here — nothing is retyped."
        actions={
          <>
            <a
              className="btn-accent"
              href={downloadUrl('/api/brief/pdf', token)}
              onClick={() => push('info', 'Generating the PDF', 'The server renders it from the same payload shown on this page.')}
              data-testid="brief-download"
            >
              <FileDown size={14} aria-hidden /> Download PDF
            </a>
            <RunButton onClick={run} loading={loading} testid="brief-rerun" />
          </>
        }
      />

      <Card title={data.title} hint={data.subtitle} testid="card-brief-head">
        <p className="text-2xs text-faint">
          Generated {fmtDateTime(data.generatedAt)} by {data.generatedBy} · you are viewing it as {user?.role}. Scope:{' '}
          {fmtCount(data.scope.datasets)} datasets, {fmtCount(data.scope.rows)} rows, {fmtCount(data.scope.anomalies)} anomalies and{' '}
          {fmtCount(data.scope.policyCards)} policy cards.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
          {data.kpis.map((k) => (
            <Kpi key={k.label} label={k.label} value={prettifyMoney(k.value)} detail={k.detail} testid={`brief-kpi-${k.label.toLowerCase().replace(/[^a-z]+/g, '-')}`} />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {data.sections.map((s) => (
          <Card key={s.heading} title={s.heading} testid={`brief-section-${s.heading.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
            <ul className="list-inside list-disc space-y-1.5 text-[0.82rem] leading-relaxed text-muted">
              {s.bullets.map((b) => (
                <li key={b}>{prettifyMoney(b)}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Sharpest anomalies" hint="Highest deviation from the robust baseline" testid="card-brief-anomalies" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-brief-anomalies"
              rows={data.topAnomalies}
              rowKey={(a, i) => `${a.datasetSlug}-${a.column}-${i}`}
              maxHeight="20rem"
              columns={[
                { key: 'severity', header: 'Severity', render: (a) => <Badge kind={a.severity}>{a.severity}</Badge> },
                {
                  key: 'what',
                  header: 'Metric · entity',
                  render: (a) => (
                    <span className="block max-w-[15rem] truncate" title={`${a.column} · ${a.entity ?? ''}`}>
                      <span className="font-semibold text-ink">{humanise(a.column)}</span>
                      <span className="block truncate text-2xs text-faint">
                        {a.entity ?? '—'} · {a.period ?? '—'} · {a.datasetSlug}
                      </span>
                    </span>
                  ),
                },
                { key: 'value', header: 'Observed', align: 'right', render: (a) => fmtNum(a.value, 2) },
                { key: 'expected', header: 'Expected', align: 'right', render: (a) => <span className="text-muted">{a.expected}</span> },
                { key: 'sigma', header: 'σ', align: 'right', render: (a) => fmtNum(a.sigma, 2) },
              ]}
            />
          </div>
        </Card>

        <Card title="Recommended portfolio" hint={`${fmtCr(data.portfolio.totalCostCr)} of a ${fmtCr(data.portfolio.budgetCr)} envelope, ${fmtPct(data.portfolio.utilisationPct)} utilised`} testid="card-brief-portfolio" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-brief-portfolio"
              rows={data.portfolio.items}
              rowKey={(i) => i.code}
              maxHeight="20rem"
              columns={[
                { key: 'code', header: 'Code', render: (i) => <span className="font-mono text-2xs text-faint">{i.code}</span> },
                { key: 'title', header: 'Intervention', render: (i) => <span className="block max-w-[16rem] truncate font-semibold text-ink" title={i.title}>{i.title}</span> },
                { key: 'impactScore', header: 'Impact', align: 'right', render: (i) => fmtNum(i.impactScore, 1) },
                { key: 'costCr', header: 'Cost', align: 'right', render: (i) => fmtCr(i.costCr) },
              ]}
            />
            <p className="mt-2 text-2xs text-faint">Total impact {fmtNum(data.portfolio.totalImpact, 1)} across {fmtCount(data.portfolio.items.length)} interventions.</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card title="Forecast headline" hint={`AI-3 · ${data.forecastHeadline.model}, MAPE ${fmtPct(data.forecastHeadline.mape)}`} testid="card-brief-forecast">
          <p className="text-[0.82rem] leading-relaxed text-muted">{data.forecastHeadline.text}</p>
          <p className="mt-2 text-2xs text-faint">
            {humanise(data.forecastHeadline.metric)} · {data.forecastHeadline.dataset}
          </p>
        </Card>
        <Card title="Correlation headline" hint={`AI-5 · ${data.correlationHeadline.dataset}`} testid="card-brief-correlation">
          <p className="text-[0.82rem] leading-relaxed text-muted">{data.correlationHeadline.text}</p>
          <Caveat>Association only — the brief never states a causal claim from a coefficient.</Caveat>
        </Card>
        <Card title="Audit attestation" hint={data.auditAttestation.algorithm} testid="card-brief-attestation">
          <p className="flex items-center gap-2">
            <ShieldCheck size={16} className={data.auditAttestation.valid ? 'text-ok' : 'text-danger'} aria-hidden />
            <Badge kind={data.auditAttestation.valid ? 'valid' : 'broken'}>{data.auditAttestation.valid ? 'chain verified' : 'chain broken'}</Badge>
            <span className="text-2xs text-muted">{fmtCount(data.auditAttestation.entries)} entries</span>
          </p>
          <p className="mt-2 break-all font-mono text-2xs leading-relaxed text-faint">head {data.auditAttestation.headHash}</p>
        </Card>
      </div>

      <Card title="Evidence notes" hint="Sources cited in the PDF footnotes" testid="card-brief-evidence">
        <ol className="list-inside list-decimal space-y-1.5 text-2xs leading-relaxed text-muted">
          {data.evidenceNotes.map((n) => (
            <li key={n}>{prettifyMoney(n)}</li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
