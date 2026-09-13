import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, FileWarning, GitBranch, ShieldAlert } from 'lucide-react';
import { BackLink } from '../components/AppShell';
import { EmptyState, ErrorState, SkeletonCards, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Kpi, KeyValues, PageHeader, RowTable, RunButton } from '../components/ui';
import { api, downloadUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { fmtCell, fmtCount, fmtDateTime, fmtPct, humanise } from '../lib/format';
import type { ColumnMeta, DatasetSummary, Row } from '../lib/types';

interface DetailResponse {
  dataset: DatasetSummary;
  columns: ColumnMeta[];
  lineageSummary: { step_no: number; step: string; status: string; rows_in: number; rows_out: number; duration_ms: number }[];
  anomalies: number;
  preview: Row[];
}
interface RowsResponse {
  dataset: { id: number; slug: string; rows: number };
  limit: number;
  offset: number;
  rows: Row[];
}
interface RejectsResponse {
  total: number;
  rejects: { id: number; source_line: number; reason_code: string; reason: string; raw_row: string; created_at: string }[];
}

const ROLE_TONE: Record<string, string> = { pii: 'critical', metric: 'medium', time: 'acknowledged', identifier: 'open' };

export default function DatasetDetail() {
  const { id = '' } = useParams();
  const { token, can } = useAuth();
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const { data, error, loading, run } = useAutoRun<{ detail: DetailResponse; rows: RowsResponse; rejects: RejectsResponse }>(
    async () => {
      const [detail, rows, rejects] = await Promise.all([
        api<DetailResponse>(`/api/datasets/${id}`, { token }),
        api<RowsResponse>(`/api/datasets/${id}/rows`, { token, query: { limit, offset: 0 } }),
        api<RejectsResponse>(`/api/datasets/${id}/rejects`, { token }),
      ]);
      return { detail, rows, rejects };
    },
    `dataset:${id}`,
  );

  const [pageRows, setPageRows] = useState<Row[] | null>(null);
  const rows = pageRows ?? data?.rows.rows ?? [];
  const columnNames = useMemo(() => (data ? data.detail.columns.map((c) => c.name) : []), [data]);

  async function loadPage(next: number) {
    if (!data) return;
    const res = await api<RowsResponse>(`/api/datasets/${id}/rows`, { token, query: { limit, offset: next } });
    setPageRows(res.rows);
    setOffset(next);
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dataset detail" subtitle="Loading columns, inferred roles and a masked preview…" />
        <SkeletonCards count={4} />
        <SkeletonTable rows={8} cols={7} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Dataset detail" />
        <ErrorState err={error} onRetry={run} what={`dataset “${id}”`} />
      </div>
    );
  }

  const d = data.detail.dataset;
  const piiCols = data.detail.columns.filter((c) => c.is_pii === 1);
  const imputed = data.detail.columns.reduce((s, c) => s + c.imputed_count, 0);

  return (
    <div className="space-y-4" data-testid="dataset-detail-page">
      <PageHeader
        title={d.name}
        subtitle={d.description}
        actions={
          <>
            <Link to="/lineage" className="btn" data-testid="detail-lineage-link">
              <GitBranch size={14} aria-hidden /> Lineage
            </Link>
            {can('datasets.export') ? (
              <a className="btn" href={downloadUrl(`/api/datasets/${d.slug}/export-masked`, token, { format: 'csv' })} data-testid="detail-export">
                <Download size={14} aria-hidden /> Masked CSV
              </a>
            ) : null}
            <RunButton onClick={run} loading={loading} label="Reload" testid="detail-reload" />
          </>
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <BackLink to="/datasets">All datasets</BackLink>
          <span className="chip font-mono">{d.slug}</span>
          <span className="chip">{d.domain}</span>
          <span className="chip">source: {d.sourceFile}</span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Rows persisted" value={fmtCount(d.rows)} detail={`ingested in ${fmtCount(d.ingestDurationMs)} ms`} testid="kpi-rows" />
        <Kpi label="Columns" value={fmtCount(d.columns)} detail={`${d.roles.metrics.length} metric · ${d.roles.dimensions.length} dimension`} testid="kpi-columns" />
        <Kpi label="Quality score" value={fmtPct(d.qualityScore)} detail="100 − reject share − null share" tone="teal" testid="kpi-quality" />
        <Kpi label="PII columns" value={fmtCount(d.piiColumns)} detail={piiCols.length ? piiCols.map((c) => c.name).join(', ') : 'none detected'} tone={d.piiColumns ? 'saffron' : 'default'} testid="kpi-pii" />
        <Kpi label="Open anomalies" value={fmtCount(data.detail.anomalies)} detail="AI-1 findings on this table" tone={data.detail.anomalies ? 'danger' : 'default'} testid="kpi-anomalies" />
      </div>

      <Card title="Inferred schema" hint="Type inference (step 3), semantic roles (step 4), PII detection (step 5) and imputation (step 7)" testid="card-schema" pad={false}>
        <div className="p-3">
          <DataTable
            testid="table-columns"
            rows={data.detail.columns}
            rowKey={(c) => c.name}
            maxHeight="26rem"
            columns={[
              {
                key: 'name',
                header: 'Column',
                render: (c) => (
                  <span className="block max-w-[14rem] truncate font-semibold text-ink" title={c.name}>
                    {c.name}
                    {c.raw_name !== c.name ? <span className="ml-1 font-mono text-2xs font-normal text-faint">← {c.raw_name}</span> : null}
                  </span>
                ),
              },
              { key: 'inferred_type', header: 'Type', render: (c) => <span className="chip">{c.inferred_type}</span> },
              { key: 'type_confidence', header: 'Conf.', align: 'right', render: (c) => fmtPct(c.type_confidence * 100, 0) },
              {
                key: 'semantic_role',
                header: 'Role',
                render: (c) => <Badge kind={ROLE_TONE[c.semantic_role] ?? 'low'}>{c.semantic_role}</Badge>,
              },
              {
                key: 'is_pii',
                header: 'PII',
                render: (c) =>
                  c.is_pii ? (
                    <Badge kind="critical">
                      <ShieldAlert size={10} aria-hidden /> {c.pii_kind ?? 'masked'}
                    </Badge>
                  ) : (
                    <span className="text-faint">—</span>
                  ),
              },
              { key: 'null_count', header: 'Nulls', align: 'right', render: (c) => fmtCount(c.null_count) },
              {
                key: 'imputed_count',
                header: 'Imputed',
                align: 'right',
                render: (c) => (c.imputed_count ? `${fmtCount(c.imputed_count)} (${c.impute_method ?? 'n/a'})` : '—'),
              },
              {
                key: 'range',
                header: 'Range / mean',
                render: (c) => (
                  <span className="block max-w-[15rem] truncate text-muted" title={`${c.min_value ?? '—'} … ${c.max_value ?? '—'}`}>
                    {c.mean_value !== null ? `μ ${fmtCell(c.name, c.mean_value)} · ` : ''}
                    {fmtCell(c.name, c.min_value)} … {fmtCell(c.name, c.max_value)}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <Card
        title="Masked rows"
        hint={`Rows ${fmtCount(offset + 1)}–${fmtCount(Math.min(offset + limit, d.rows))} of ${fmtCount(d.rows)} · PII columns show salted SHA-256 tokens only`}
        testid="card-rows"
        right={
          <span className="flex items-center gap-1.5">
            <button type="button" className="btn px-2 py-1 text-2xs" disabled={offset === 0} onClick={() => void loadPage(Math.max(0, offset - limit))} data-testid="rows-prev">
              Prev
            </button>
            <button type="button" className="btn px-2 py-1 text-2xs" disabled={offset + limit >= d.rows} onClick={() => void loadPage(offset + limit)} data-testid="rows-next">
              Next
            </button>
          </span>
        }
      >
        <RowTable columns={columnNames} rows={rows as unknown as Record<string, unknown>[]} testid="table-rows" />
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Rejected source rows" hint="Step 9 schema validation — kept verbatim with a reason code" testid="card-rejects">
          {data.rejects.rejects.length === 0 ? (
            <EmptyState title="No rows were rejected">
              <p>Every source line satisfied the inferred schema, so `ingest_rejects` holds nothing for this dataset.</p>
            </EmptyState>
          ) : (
            <ul className="space-y-2.5" data-testid="list-rejects">
              {data.rejects.rejects.map((r) => (
                <li key={r.id} className="min-w-0 rounded-lg border border-line bg-raised p-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-2xs">
                    <Badge kind="critical">
                      <FileWarning size={10} aria-hidden /> {r.reason_code}
                    </Badge>
                    <span className="text-muted">line {fmtCount(r.source_line)}</span>
                    <span className="text-faint">{r.reason}</span>
                  </p>
                  <p className="mt-1.5 break-all font-mono text-2xs leading-relaxed text-faint">{r.raw_row}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Ingestion facts" hint="Written by the pipeline, not by hand" testid="card-facts">
          <KeyValues
            items={[
              { k: 'Ingested at', v: fmtDateTime(d.ingestedAt) },
              { k: 'Ingested by', v: d.ingestedBy },
              { k: 'Pipeline duration', v: `${fmtCount(d.ingestDurationMs)} ms` },
              { k: 'Values imputed', v: fmtCount(imputed) },
              { k: 'Rejects retained', v: fmtCount(data.rejects.total) },
              { k: 'Time column', v: d.roles.time.length ? d.roles.time.map(humanise).join(', ') : 'none (cross-sectional)' },
              { k: 'Dimensions', v: d.roles.dimensions.length ? d.roles.dimensions.join(', ') : '—' },
              { k: 'Metrics', v: d.roles.metrics.length ? d.roles.metrics.join(', ') : '—' },
            ]}
          />
          <div className="mt-4">
            <p className="label">Lineage steps recorded</p>
            <ol className="flex flex-wrap gap-1.5" data-testid="list-lineage-chips">
              {data.detail.lineageSummary.map((s) => (
                <li key={s.step_no} className="chip" title={`${fmtCount(s.rows_in)} → ${fmtCount(s.rows_out)} rows in ${s.duration_ms} ms`}>
                  {s.step_no}. {humanise(s.step)}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </div>
    </div>
  );
}
