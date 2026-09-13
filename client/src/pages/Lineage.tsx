import { useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, ShieldCheck } from 'lucide-react';
import { DetailView } from '../components/DetailView';
import { ErrorState, SkeletonCards, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Kpi, PageHeader, RunButton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useAutoRun } from '../lib/hooks';
import { fmtCount, humanise } from '../lib/format';
import type { DatasetSummary, LineageStep } from '../lib/types';

interface LineageIndex {
  datasets: { dataset_id: number; slug: string; name: string; steps: number; total_ms: number; rows_out: number }[];
}
interface LineageDetail {
  dataset: DatasetSummary;
  steps: LineageStep[];
}

export default function Lineage() {
  const { token } = useAuth();
  const { selected, byslug } = useDatasets();
  const [open, setOpen] = useState<number | null>(1);

  const { data, error, loading, run } = useAutoRun<{ index: LineageIndex; detail: LineageDetail | null }>(
    async () => {
      const index = await api<LineageIndex>('/api/lineage', { token });
      const target = selected || index.datasets[0]?.slug;
      const ds = target ? byslug(target) : undefined;
      const id = ds?.id ?? index.datasets.find((d) => d.slug === target)?.dataset_id;
      const detail = id ? await api<LineageDetail>(`/api/lineage/${id}`, { token }) : null;
      return { index, detail };
    },
    `lineage:${selected}`,
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Lineage & PII" subtitle="Loading the recorded pipeline steps…" />
        <SkeletonCards count={3} />
        <SkeletonTable rows={10} cols={4} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Lineage & PII" />
        <ErrorState err={error} onRetry={run} what="lineage" />
      </div>
    );
  }

  const steps = data.detail?.steps ?? [];
  const ds = data.detail?.dataset;
  const totalMs = steps.reduce((s, x) => s + x.durationMs, 0);
  const dropped = steps.length ? (steps[0]?.rowsIn ?? 0) - (steps[steps.length - 1]?.rowsOut ?? 0) : 0;

  return (
    <div className="space-y-4" data-testid="lineage-page">
      <PageHeader
        title="Lineage & PII evidence"
        subtitle="Ten steps are recorded for every dataset with rows in, rows out, duration and the evidence payload the step produced — including the PII kinds detected and the masking salt fingerprint."
        actions={<RunButton onClick={run} loading={loading} testid="lineage-rerun" />}
      >
        <p className="mt-2 text-2xs text-faint">
          Showing <span className="font-semibold text-muted">{ds?.name ?? '—'}</span> — switch datasets from the top bar.
        </p>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Steps recorded" value={fmtCount(steps.length)} detail="parse → persist" testid="kpi-steps" />
        <Kpi label="Pipeline duration" value={`${fmtCount(totalMs)} ms`} detail="sum of measured step durations" tone="teal" testid="kpi-duration" />
        <Kpi label="Rows out" value={fmtCount(steps[steps.length - 1]?.rowsOut ?? 0)} detail={`${fmtCount(dropped)} source rows dropped or rejected`} testid="kpi-rows-out" />
        <Kpi label="PII columns masked" value={fmtCount(ds?.piiColumns ?? 0)} detail="salted SHA-256, original never stored" tone={ds?.piiColumns ? 'saffron' : 'default'} testid="kpi-pii" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.6fr]">
        <Card title="All datasets" hint="Step count, measured duration and final row count" testid="card-lineage-index" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-lineage-index"
              rows={data.index.datasets}
              rowKey={(d) => d.slug}
              maxHeight="30rem"
              columns={[
                {
                  key: 'name',
                  header: 'Dataset',
                  render: (d) => (
                    <span className={`block max-w-[13rem] truncate font-semibold ${d.slug === ds?.slug ? 'text-teal' : 'text-ink'}`} title={d.name}>
                      {d.name}
                    </span>
                  ),
                },
                { key: 'steps', header: 'Steps', align: 'right', render: (d) => fmtCount(d.steps) },
                { key: 'total_ms', header: 'Duration', align: 'right', render: (d) => `${fmtCount(d.total_ms)} ms` },
                { key: 'rows_out', header: 'Rows', align: 'right', render: (d) => fmtCount(d.rows_out) },
              ]}
            />
          </div>
        </Card>

        <Card
          title={`Recorded steps — ${ds?.name ?? 'dataset'}`}
          hint="Click a step to read the evidence the pipeline stored for it"
          testid="card-lineage-steps"
        >
          <ol className="space-y-2" data-testid="list-lineage-steps">
            {steps.map((s) => {
              const isOpen = open === s.stepNo;
              return (
                <li key={s.stepNo} className="rounded-lg border border-line bg-raised">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 p-2.5 text-left"
                    onClick={() => setOpen(isOpen ? null : s.stepNo)}
                    data-testid={`lineage-step-${s.stepNo}`}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-teal" aria-hidden /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.8rem] font-bold text-ink">
                          {s.stepNo}. {humanise(s.step)}
                        </span>
                        <Badge kind={s.status === 'ok' ? 'acknowledged' : 'critical'}>{s.status}</Badge>
                        {s.step.includes('pii') ? (
                          <Badge kind="open">
                            <ShieldCheck size={10} aria-hidden /> DPDP 2023
                          </Badge>
                        ) : null}
                      </span>
                      <span className="num mt-0.5 block truncate text-2xs text-faint">
                        {fmtCount(s.rowsIn)} → {fmtCount(s.rowsOut)} rows · {fmtCount(s.durationMs)} ms
                      </span>
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="border-t border-line px-3 py-3">
                      <DetailView detail={s.detail} testid={`lineage-detail-${s.stepNo}`} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
            <GitBranch size={12} aria-hidden /> Lineage rows are written inside the same transaction as the physical table, so the two can
            never disagree.
          </p>
        </Card>
      </div>
    </div>
  );
}
