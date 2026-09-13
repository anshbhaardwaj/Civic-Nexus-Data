import { useState } from 'react';
import { Download, Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { DetailView } from '../components/DetailView';
import { EmptyState, ErrorState, SkeletonCards, SkeletonTable, StateBlock } from '../components/states';
import { Badge, Card, DataTable, Formula, Kpi, PageHeader, RunButton } from '../components/ui';
import { api, downloadUrl, errMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { fmtCount, fmtDateTime } from '../lib/format';
import type { AuditEntry, AuditVerify } from '../lib/types';

interface AuditList {
  total: number;
  limit: number;
  offset: number;
  entries: AuditEntry[];
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : { value: String(v) };
  } catch {
    return { raw: json };
  }
}

export default function Audit() {
  const { token, can } = useAuth();
  const { push } = useToast();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<AuditVerify | null>(null);

  const { data, error, loading, run } = useAutoRun<{ list: AuditList; verify: AuditVerify }>(
    async () => {
      const query: Record<string, string | number> = { limit: 100 };
      if (action) query['action'] = action;
      if (actor) query['actor'] = actor;
      const [list, v] = await Promise.all([api<AuditList>('/api/audit', { token, query }), api<AuditVerify>('/api/audit/verify', { token })]);
      setVerify(v);
      return { list, verify: v };
    },
    `audit:${action}:${actor}`,
  );

  async function runVerify() {
    setVerifying(true);
    try {
      const v = await api<AuditVerify>('/api/audit/verify', { token });
      setVerify(v);
      push(
        v.valid ? 'success' : 'error',
        v.valid ? 'Audit chain verified' : 'Audit chain broken',
        v.valid
          ? `All ${fmtCount(v.entries)} entries recompute to the stored hashes; head ${v.headHash.slice(0, 16)}…`
          : `Chain diverges at entry ${v.brokenAt ?? '?'} — ${v.reason ?? 'hash mismatch'}`,
      );
    } catch (err) {
      push('error', 'Verification failed', errMessage(err));
    } finally {
      setVerifying(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Audit chain" subtitle="Recomputing the hash chain…" />
        <SkeletonCards count={4} />
        <SkeletonTable rows={10} cols={6} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="Audit chain" />
        <ErrorState err={error} onRetry={run} what="the audit chain" />
      </div>
    );
  }

  const v = verify ?? data.verify;
  const entries = data.list.entries;
  const active = entries.find((e) => e.id === pick) ?? entries[0];
  const actions = Array.from(new Set(entries.map((e) => e.action))).sort();
  const actors = Array.from(new Set(entries.map((e) => e.actor))).sort();

  return (
    <div className="space-y-4" data-testid="audit-page">
      <PageHeader
        title="Audit chain"
        subtitle="Every mutation — login, ingest, anomaly acknowledgement, policy refresh, user change — is appended as a hash-linked entry. Each hash covers the previous hash, so altering any historical row invalidates everything after it."
        actions={
          <>
            <button type="button" className="btn-primary" onClick={() => void runVerify()} disabled={verifying} data-testid="audit-verify">
              <ShieldCheck size={14} aria-hidden /> {verifying ? 'Recomputing…' : 'Verify chain'}
            </button>
            {can('audit.export') ? (
              <a className="btn" href={downloadUrl('/api/audit/export', token)} data-testid="audit-export">
                <Download size={14} aria-hidden /> Export chain
              </a>
            ) : null}
            <RunButton onClick={run} loading={loading} testid="audit-rerun" />
          </>
        }
      />

      {v.valid ? (
        <StateBlock title={`Chain verified — ${fmtCount(v.entries)} entries recompute exactly`} tone="info" testid="audit-status" icon={<ShieldCheck size={18} aria-hidden />}>
          <p>
            Every entry was re-hashed from its own fields plus the previous hash and matched the stored value, so no row has been edited,
            reordered or removed since it was written.
          </p>
          <p className="break-all font-mono text-2xs text-faint">head {v.headHash}</p>
        </StateBlock>
      ) : (
        <StateBlock title="Chain integrity failure" tone="danger" testid="audit-status" icon={<ShieldAlert size={18} aria-hidden />}>
          <p>
            Recomputation diverges at entry {v.brokenAt ?? 'unknown'}: {v.reason ?? 'stored hash does not match the recomputed hash'}. Every entry
            after that point should be treated as untrustworthy.
          </p>
        </StateBlock>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Entries in chain" value={fmtCount(v.entries)} detail="append-only, never updated in place" testid="kpi-entries" />
        <Kpi label="Verification" value={v.valid ? 'Valid' : 'Broken'} detail={v.valid ? 'all hashes recompute' : `breaks at ${v.brokenAt ?? '?'}`} tone={v.valid ? 'ok' : 'danger'} testid="kpi-valid" />
        <Kpi label="Distinct actions" value={fmtCount(actions.length)} detail={actions.slice(0, 4).join(', ')} testid="kpi-actions" />
        <Kpi label="Distinct actors" value={fmtCount(actors.length)} detail={actors.slice(0, 3).join(', ')} testid="kpi-actors" />
      </div>

      <Card
        title="Entries"
        hint={`${fmtCount(data.list.total)} total · newest first · select a row to inspect its payload and hash inputs`}
        testid="card-audit-entries"
        pad={false}
        right={
          <span className="flex flex-wrap items-center gap-1.5">
            <select className="input py-1 text-2xs" value={action} onChange={(e) => setAction(e.target.value)} data-testid="audit-filter-action" aria-label="Filter by action">
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select className="input py-1 text-2xs" value={actor} onChange={(e) => setActor(e.target.value)} data-testid="audit-filter-actor" aria-label="Filter by actor">
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </span>
        }
      >
        <div className="p-3">
          {entries.length === 0 ? (
            <EmptyState title="No entries match these filters">
              <p>The chain holds {fmtCount(v.entries)} entries in total — clear the action or actor filter to see them.</p>
            </EmptyState>
          ) : (
            <DataTable
              testid="table-audit"
              rows={entries}
              rowKey={(e) => e.id}
              maxHeight="30rem"
              onRowClick={(e) => setPick(e.id)}
              rowTestid={(e) => `audit-row-${e.id}`}
              columns={[
                { key: 'seq', header: '#', align: 'right', render: (e) => <span className="font-mono text-2xs text-faint">{e.seq}</span> },
                { key: 'ts', header: 'When', render: (e) => <span className="text-muted">{fmtDateTime(e.ts)}</span> },
                {
                  key: 'actor',
                  header: 'Actor',
                  render: (e) => (
                    <span className="block max-w-[12rem] truncate" title={e.actor}>
                      <span className="font-semibold text-ink">{e.actor}</span>
                      <span className="block truncate text-2xs text-faint">{e.actor_role}</span>
                    </span>
                  ),
                },
                { key: 'action', header: 'Action', render: (e) => <Badge kind="medium">{e.action}</Badge> },
                { key: 'entity', header: 'Entity', render: (e) => <span className="block max-w-[14rem] truncate text-muted" title={e.entity}>{e.entity}</span> },
                {
                  key: 'hash',
                  header: 'Hash',
                  render: (e) => (
                    <span className="font-mono text-2xs text-faint" title={e.hash}>
                      {e.hash.slice(0, 12)}…
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      {active ? (
        <Card title={`Entry #${active.seq} — ${active.action}`} hint={`${active.actor} (${active.actor_role}) · ${fmtDateTime(active.ts)}`} testid="card-audit-detail">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="min-w-0 space-y-3">
              <p className="label">Payload recorded</p>
              <DetailView detail={safeParse(active.payload_json)} testid="audit-payload" />
            </div>
            <div className="min-w-0 space-y-2.5">
              <Formula label="Hash inputs">{v.method ?? v.algorithm}</Formula>
              {[
                { k: 'Previous hash', val: active.prev_hash },
                { k: 'Payload hash', val: active.payload_hash },
                { k: 'This entry hash', val: active.hash },
              ].map((x) => (
                <div key={x.k} className="min-w-0">
                  <p className="label flex items-center gap-1.5">
                    <Link2 size={11} aria-hidden /> {x.k}
                  </p>
                  <p className="break-all font-mono text-2xs leading-relaxed text-muted">{x.val}</p>
                </div>
              ))}
              <p className="text-2xs leading-relaxed text-faint">
                Because this entry's hash is an input to the next one, editing the payload above would require recomputing every later hash — which
                is exactly what the verify button checks.
              </p>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
