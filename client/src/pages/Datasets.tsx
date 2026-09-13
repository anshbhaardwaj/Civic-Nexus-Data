import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ShieldAlert, Trash2 } from 'lucide-react';
import { ErrorState, SkeletonCards, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Kpi, PageHeader, RunButton } from '../components/ui';
import { api, downloadUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useToast } from '../lib/toast';
import { fmtCount, fmtDateTime, fmtPct } from '../lib/format';
import type { DatasetSummary } from '../lib/types';

interface ListResponse {
  datasets: DatasetSummary[];
  totals: { datasets: number; rows: number; piiColumnsMasked: number; rejects: number };
}

export default function Datasets() {
  const { token, can, user } = useAuth();
  const { datasets, loading, error, reload, select } = useDatasets();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const totals: ListResponse['totals'] = {
    datasets: datasets.length,
    rows: datasets.reduce((s, d) => s + d.rows, 0),
    piiColumnsMasked: datasets.reduce((s, d) => s + d.piiColumns, 0),
    rejects: datasets.reduce((s, d) => s + d.rejects, 0),
  };

  async function remove(d: DatasetSummary) {
    setBusy(d.slug);
    try {
      await api(`/api/datasets/${d.slug}`, { token, method: 'DELETE' });
      push('success', `Dropped ${d.name}`, `Physical table ds_${d.slug} removed and the deletion appended to the audit chain.`);
      await reload();
    } catch (err) {
      push('error', 'Delete failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && datasets.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dataset catalogue" subtitle="Loading the ingested catalogue…" />
        <SkeletonCards count={4} />
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Dataset catalogue" />
        <ErrorState err={error} onRetry={() => void reload()} what="the dataset catalogue" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="datasets-page">
      <PageHeader
        title="Dataset catalogue"
        subtitle="Every dataset was parsed, typed, PII-masked, imputed, de-duplicated and validated by the 10-step pipeline before it reached a physical ds_* table."
        actions={<RunButton onClick={() => void reload()} loading={loading} label="Reload" testid="datasets-reload" />}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Datasets" value={fmtCount(totals.datasets)} detail="each with 10 lineage steps" testid="kpi-datasets" />
        <Kpi label="Rows persisted" value={fmtCount(totals.rows)} detail="post-dedupe, post-validation" tone="teal" testid="kpi-rows" />
        <Kpi label="PII columns masked" value={fmtCount(totals.piiColumnsMasked)} detail="salted SHA-256, originals never stored" tone="saffron" testid="kpi-pii" />
        <Kpi label="Rejected source rows" value={fmtCount(totals.rejects)} detail="kept with reason codes for audit" tone="danger" testid="kpi-rejects" />
      </div>

      <Card title="Catalogue" hint={`Signed in as ${user?.role} — export ${can('datasets.export') ? 'enabled' : 'withheld'}, delete ${can('datasets.delete') ? 'enabled' : 'withheld'}`} testid="card-catalogue" pad={false}>
        <div className="p-3">
          <DataTable
            testid="table-datasets"
            rows={datasets}
            rowKey={(d) => d.slug}
            maxHeight="34rem"
            columns={[
              {
                key: 'name',
                header: 'Dataset',
                render: (d) => (
                  <Link
                    to={`/datasets/${d.slug}`}
                    className="block max-w-[17rem] font-semibold text-ink hover:text-teal"
                    onClick={() => select(d.slug)}
                    data-testid={`dataset-link-${d.slug}`}
                    title={d.name}
                  >
                    <span className="block truncate">{d.name}</span>
                    <span className="block truncate font-mono text-2xs font-normal text-faint">{d.slug}</span>
                  </Link>
                ),
              },
              { key: 'domain', header: 'Domain', render: (d) => <span className="chip">{d.domain}</span> },
              { key: 'rows', header: 'Rows', align: 'right', render: (d) => fmtCount(d.rows) },
              { key: 'columns', header: 'Cols', align: 'right', render: (d) => fmtCount(d.columns) },
              {
                key: 'piiColumns',
                header: 'PII',
                align: 'right',
                render: (d) =>
                  d.piiColumns > 0 ? (
                    <Badge kind="critical" testid={`pii-${d.slug}`}>
                      <ShieldAlert size={10} aria-hidden /> {d.piiColumns}
                    </Badge>
                  ) : (
                    <span className="text-faint">—</span>
                  ),
              },
              { key: 'qualityScore', header: 'Quality', align: 'right', render: (d) => fmtPct(d.qualityScore) },
              { key: 'ingestedAt', header: 'Ingested', render: (d) => <span className="text-muted">{fmtDateTime(d.ingestedAt)}</span> },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (d) => (
                  <span className="flex items-center justify-end gap-1.5">
                    {can('datasets.export') ? (
                      <a
                        className="btn px-2 py-1 text-2xs"
                        href={downloadUrl(`/api/datasets/${d.slug}/export-masked`, token, { format: 'csv' })}
                        data-testid={`export-${d.slug}`}
                        title="Download the masked CSV (0 raw PII values)"
                      >
                        <Download size={11} aria-hidden /> Masked CSV
                      </a>
                    ) : null}
                    {can('datasets.delete') ? (
                      <button
                        type="button"
                        className="btn px-2 py-1 text-2xs hover:border-danger/60 hover:text-danger"
                        onClick={() => void remove(d)}
                        disabled={busy === d.slug}
                        data-testid={`delete-${d.slug}`}
                      >
                        <Trash2 size={11} aria-hidden /> {busy === d.slug ? 'Dropping…' : 'Drop'}
                      </button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <p className="text-2xs leading-relaxed text-faint">
        Masked exports replace every detected PII value with a salted SHA-256 base36 token that always starts with a letter; the per-dataset
        salt never leaves the server and the original value is never persisted.
      </p>
    </div>
  );
}
