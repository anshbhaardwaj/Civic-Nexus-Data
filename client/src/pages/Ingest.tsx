import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileUp, Loader2, Upload, Zap } from 'lucide-react';
import { EmptyState, ErrorState, StateBlock } from '../components/states';
import { Badge, Card, Grid, Kpi, KeyValues, PageHeader } from '../components/ui';
import { api, errMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useToast } from '../lib/toast';
import { fmtCount, fmtPct, humanise } from '../lib/format';
import type { LiveTickResponse } from '../lib/types';

interface IngestStep {
  step: string;
  status: string;
  rowsIn: number;
  rowsOut: number;
  detail: Record<string, unknown>;
}
interface IngestResponse {
  ingest: {
    datasetId: number;
    slug: string;
    tableName: string;
    rows: number;
    columns: number;
    rejects: number;
    piiColumns: number;
    qualityScore: number;
    durationMs: number;
    steps: IngestStep[];
  };
  anomalyScan: { datasets?: number; detected: number; persisted: number; bySeverity: Record<string, number> };
}

const STEP_NOTES: Record<string, string> = {
  parse: 'RFC4180 quote- and delimiter-aware split; ragged rows deferred to step 9',
  header_normalisation: 'trim → snake_case → dedupe collisions with a _2 suffix',
  type_inference: 'regex vote per value; ≥95% share wins, else best ratio at reduced confidence',
  semantic_role_inference: 'name pattern + inferred type + cardinality ratio → dimension / metric / time / identifier / pii',
  pii_detection: 'header patterns plus value regexes for name, phone, email, 12-digit Aadhaar-like and address',
  pii_masking: 'salted SHA-256 → base36 token that always starts with a letter; the original is never stored',
  imputation: 'numeric → median, categorical → mode, time → forward fill, counted per column',
  deduplication: 'inferred identifier, else full-row hash',
  schema_validation: 'rows failing the inferred schema are kept in ingest_rejects with a reason code',
  persist: 'writes the physical ds_* table, the lineage rows and one audit-chain entry',
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export default function Ingest() {
  const { token } = useAuth();
  const { reload, select } = useDatasets();
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('Uploaded');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setContent(text);
    setFileName(file.name);
    setFormat(file.name.endsWith('.json') ? 'json' : 'csv');
    const base = slugify(file.name);
    setSlug(`${base}_upload`);
    setName(humanise(base));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<IngestResponse>('/api/datasets/ingest', {
        token,
        method: 'POST',
        body: { slug, name, domain, description: `Uploaded from ${fileName || 'pasted text'} through the 10-step pipeline.`, sourceFile: fileName || 'pasted.csv', format, content },
      });
      setResult(res);
      push(
        'success',
        `Ingested ${fmtCount(res.ingest.rows)} rows into ${res.ingest.tableName}`,
        `${res.ingest.columns} columns · ${res.ingest.rejects} rejects · quality ${fmtPct(res.ingest.qualityScore)} · AI-1 found ${fmtCount(res.anomalyScan.detected)} anomalies`,
      );
      await reload();
      select(res.ingest.slug);
    } catch (err) {
      setError(err);
      push('error', 'Ingestion rejected', errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function tick() {
    setTicking(true);
    try {
      const res = await api<LiveTickResponse>('/api/live/tick', { token, method: 'POST', body: { spikeProbability: 0.4 } });
      const scan = (res['anomalyScan'] ?? {}) as { detected?: number };
      push(
        'success',
        `Live tick appended ${fmtCount(Number(res['rowsAppended'] ?? 0))} rows`,
        `${String((res['dataset'] as { name?: string } | undefined)?.name ?? '')} · rows ${fmtCount(Number(res['rowCountBefore'] ?? 0))} → ${fmtCount(
          Number(res['rowCountAfter'] ?? 0),
        )} · AI-1 rescan detected ${fmtCount(Number(scan.detected ?? 0))}`,
      );
      await reload();
    } catch (err) {
      push('error', 'Live tick failed', errMessage(err));
    } finally {
      setTicking(false);
    }
  }

  const ready = content.trim().length > 0 && slug.trim().length > 1 && name.trim().length > 1;

  return (
    <div className="space-y-4" data-testid="ingest-page">
      <PageHeader
        title="Ingest pipeline"
        subtitle="Upload a CSV or JSON extract. It runs through the same ten recorded steps as the seeded datasets — parse, header normalisation, type and role inference, PII detection and masking, imputation, dedupe, validation and persist."
        actions={
          <button type="button" className="btn-accent" onClick={() => void tick()} disabled={ticking} data-testid="live-tick-button">
            {ticking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Zap size={14} aria-hidden />} Live telemetry tick
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.25fr]">
        <Card title="Upload" hint="Files are read in the browser and posted as text — nothing leaves this host" testid="card-upload">
          <div className="space-y-3">
            <div>
              <span className="label">Source file</span>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line bg-raised px-3 py-4 text-left hover:border-teal/60"
                onClick={() => fileRef.current?.click()}
                data-testid="file-picker"
              >
                <FileUp size={18} className="shrink-0 text-teal" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{fileName || 'Choose a .csv or .json extract'}</span>
                  <span className="block truncate text-2xs text-faint">
                    {content ? `${fmtCount(content.split('\n').length - 1)} source lines loaded` : 'e.g. seed/traffic_congestion.csv'}
                  </span>
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="hidden"
                data-testid="file-input"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="slug">
                  Slug (table becomes ds_&lt;slug&gt;)
                </label>
                <input id="slug" className="input font-mono" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} data-testid="ingest-slug" />
              </div>
              <div>
                <label className="label" htmlFor="dsname">
                  Display name
                </label>
                <input id="dsname" className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="ingest-name" />
              </div>
              <div>
                <label className="label" htmlFor="domain">
                  Domain
                </label>
                <input id="domain" className="input" value={domain} onChange={(e) => setDomain(e.target.value)} data-testid="ingest-domain" />
              </div>
              <div>
                <label className="label" htmlFor="format">
                  Format
                </label>
                <select id="format" className="input" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')} data-testid="ingest-format">
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="content">
                Payload preview (editable)
              </label>
              <textarea
                id="content"
                className="input h-28 resize-y font-mono text-2xs leading-relaxed"
                value={content.slice(0, 4000)}
                onChange={(e) => setContent(e.target.value)}
                placeholder="district,month,calls&#10;Pune,2026-01,5914"
                data-testid="ingest-content"
              />
            </div>

            <button type="button" className="btn-primary w-full" onClick={() => void submit()} disabled={!ready || busy} data-testid="ingest-submit">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
              {busy ? 'Running the 10 steps…' : 'Ingest through the pipeline'}
            </button>
            {!ready ? <p className="text-2xs text-faint">Pick a file (or paste rows) and give the dataset a slug and a name to enable ingestion.</p> : null}
          </div>
        </Card>

        <Card title="Pipeline result" hint="Each step reports rows in, rows out and its own evidence payload" testid="card-result">
          {error ? <ErrorState err={error} what="the upload" /> : null}
          {!error && !result ? (
            <EmptyState title="No upload in this session yet">
              <p>
                The eight seeded datasets were ingested through this exact pipeline at boot — open{' '}
                <Link to="/lineage" className="font-semibold text-teal hover:underline">
                  Lineage &amp; PII
                </Link>{' '}
                to inspect their recorded steps, or upload a file to watch the ten steps run live.
              </p>
            </EmptyState>
          ) : null}

          {result ? (
            <div className="space-y-4" data-testid="ingest-result">
              <Grid cols={4}>
                <Kpi label="Rows persisted" value={fmtCount(result.ingest.rows)} testid="ingest-kpi-rows" />
                <Kpi label="Columns" value={fmtCount(result.ingest.columns)} testid="ingest-kpi-columns" />
                <Kpi label="Quality" value={fmtPct(result.ingest.qualityScore)} tone="teal" testid="ingest-kpi-quality" />
                <Kpi label="Anomalies found" value={fmtCount(result.anomalyScan.detected)} tone="danger" testid="ingest-kpi-anomalies" />
              </Grid>

              <KeyValues
                items={[
                  { k: 'Physical table', v: <span className="font-mono">{result.ingest.tableName}</span> },
                  { k: 'Dataset id', v: fmtCount(result.ingest.datasetId) },
                  { k: 'Rejected rows', v: fmtCount(result.ingest.rejects) },
                  { k: 'PII columns masked', v: fmtCount(result.ingest.piiColumns) },
                  { k: 'Pipeline duration', v: `${fmtCount(result.ingest.durationMs)} ms` },
                  {
                    k: 'AI-1 rescan',
                    v: Object.entries(result.anomalyScan.bySeverity)
                      .filter(([, n]) => n > 0)
                      .map(([s, n]) => `${n} ${s}`)
                      .join(' · ') || 'no anomalies flagged',
                  },
                ]}
              />

              <ol className="space-y-2" data-testid="list-steps">
                {result.ingest.steps.map((s, i) => (
                  <li key={s.step} className="flex min-w-0 items-start gap-2.5 rounded-lg border border-line bg-raised p-2.5">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.8rem] font-bold text-ink">
                          {i + 1}. {humanise(s.step)}
                        </span>
                        <Badge kind={s.status === 'ok' ? 'acknowledged' : 'critical'}>{s.status}</Badge>
                        <span className="num text-2xs text-faint">
                          {fmtCount(s.rowsIn)} → {fmtCount(s.rowsOut)} rows
                        </span>
                      </p>
                      <p className="mt-0.5 text-2xs leading-relaxed text-muted">{STEP_NOTES[s.step] ?? 'recorded in lineage_steps'}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <StateBlock title="Where to look next" tone="info" testid="ingest-next">
                <p>
                  The new table is in the dataset switcher and the{' '}
                  <Link to={`/datasets/${result.ingest.slug}`} className="font-semibold text-teal hover:underline" data-testid="ingest-open-dataset">
                    dataset detail page
                  </Link>
                  ; its ten steps are in Lineage and the ingest itself is now an entry in the audit chain.
                </p>
              </StateBlock>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
