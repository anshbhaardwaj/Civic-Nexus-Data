import { AlertTriangle, Ban, Inbox, Info, RefreshCw, ServerCrash } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError, errMessage } from '../lib/api';

/* ------------------------------------------------------------------ skeletons */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skel ${className}`} data-testid="skeleton" aria-hidden />;
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} data-testid="skeleton-text" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skel h-3" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, height = 'h-24' }: { count?: number; height?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="skeleton-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`card card-pad ${height}`}>
          <div className="skel h-2.5 w-2/3" />
          <div className="skel mt-3 h-6 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 260 }: { height?: number }) {
  return (
    <div className="card card-pad" data-testid="skeleton-chart">
      <div className="skel h-2.5 w-40" />
      <div className="skel mt-4 w-full" style={{ height }} />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden" data-testid="skeleton-table">
      <div className="flex gap-3 border-b border-line px-3 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skel h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 border-b border-line/60 px-3 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skel h-3 flex-1" style={{ opacity: 1 - r * 0.08 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- states */

interface StateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testid?: string;
  tone?: 'danger' | 'warn' | 'info' | 'neutral';
  icon?: ReactNode;
}

const TONES = {
  danger: 'border-danger/40 bg-danger/5 text-danger',
  warn: 'border-warn/40 bg-warn/5 text-warn',
  info: 'border-teal/40 bg-teal/5 text-teal',
  neutral: 'border-line bg-raised text-muted',
} as const;

export function StateBlock({ title, children, action, testid, tone = 'neutral', icon }: StateProps) {
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${TONES[tone]}`} data-testid={testid} role="status">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">{title}</p>
          {children ? <div className="mt-1.5 space-y-1.5 break-words text-[0.8rem] leading-relaxed text-muted">{children}</div> : null}
          {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Explicit "not permitted for your role" (SPEC §8). */
export function DeniedState({ permission, role, message }: { permission?: string; role?: string; message?: string }) {
  return (
    <StateBlock title="Not permitted for your role" tone="warn" testid="state-denied" icon={<Ban size={18} aria-hidden />}>
      <p>
        {message ??
          `The ${role ? `“${role}”` : 'current'} role does not carry${permission ? ` the permission “${permission}”` : ' this permission'}, so this view is withheld.`}
      </p>
      <p className="text-faint">
        RBAC is enforced server-side as well — the API answers 403 FORBIDDEN for this route, and the attempt is written to the audit chain.
      </p>
    </StateBlock>
  );
}

/** 422 NOT_APPLICABLE — explain, never render a blank chart (SPEC §8). */
export function NotApplicableState({ err, hint }: { err: ApiError; hint?: ReactNode }) {
  const details = (err.details ?? {}) as Record<string, unknown>;
  const facts = Object.entries(details).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  return (
    <StateBlock
      title="This engine does not apply to the selected dataset"
      tone="info"
      testid="state-not-applicable"
      icon={<Info size={18} aria-hidden />}
    >
      <p className="text-ink">{err.message}</p>
      {facts.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {facts.map(([k, v]) => (
            <li key={k} className="chip">
              {k}: {String(v)}
            </li>
          ))}
        </ul>
      ) : null}
      {hint}
      <p className="text-faint">
        The API returned <code className="font-mono text-2xs">422 NOT_APPLICABLE</code> rather than inventing a series — cross-sectional
        tables have no time axis to project along.
      </p>
    </StateBlock>
  );
}

/** Any other failure: show the API's own message plus a retry. */
export function ErrorState({ err, onRetry, what }: { err: unknown; onRetry?: () => void; what?: string }) {
  const api = err instanceof ApiError ? err : null;
  return (
    <StateBlock
      title={`Could not load ${what ?? 'this view'}`}
      tone="danger"
      testid="state-error"
      icon={<ServerCrash size={18} aria-hidden />}
      action={
        onRetry ? (
          <button type="button" className="btn" onClick={onRetry} data-testid="retry-button">
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        ) : null
      }
    >
      <p className="text-ink">{errMessage(err)}</p>
      <p className="text-faint">
        {api ? (
          <>
            API status <span className="font-mono">{api.status || 'network'}</span> · code <span className="font-mono">{api.code}</span>
          </>
        ) : (
          'Unexpected client error.'
        )}
      </p>
    </StateBlock>
  );
}

/** Genuinely-empty result: always says why and what to do next. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <StateBlock title={title} tone="neutral" testid="state-empty" icon={<Inbox size={18} aria-hidden />} action={action}>
      {children}
    </StateBlock>
  );
}

/** Small inline caveat used under charts and scores. */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-faint" data-testid="caveat">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span className="break-words">{children}</span>
    </p>
  );
}
