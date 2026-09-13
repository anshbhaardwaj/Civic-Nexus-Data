import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { fmtCell, humanise } from '../lib/format';

/* ------------------------------------------------------------------- layout */

export function PageHeader({
  title,
  subtitle,
  engine,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  engine?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-col gap-3 border-b border-line pb-4 xl:flex-row xl:items-end xl:justify-between" data-testid="page-header">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {engine ? (
            <span className="rounded-md border border-teal/40 bg-teal/10 px-1.5 py-0.5 font-mono text-2xs font-bold text-teal" data-testid="engine-tag">
              {engine}
            </span>
          ) : null}
          <h1 className="truncate text-lg font-extrabold tracking-tight text-ink sm:text-xl" data-testid="page-title">
            {title}
          </h1>
        </div>
        {subtitle ? <p className="mt-1 max-w-3xl text-[0.8rem] leading-relaxed text-muted">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  hint,
  right,
  children,
  className = '',
  testid,
  pad = true,
}: {
  title?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  testid?: string;
  pad?: boolean;
}) {
  return (
    <section className={`card ${className}`} data-testid={testid}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-ink">{title}</h2>
            {hint ? <p className="mt-0.5 break-words text-2xs leading-relaxed text-faint">{hint}</p> : null}
          </div>
          {right ? <div className="min-w-0 max-w-full shrink-0">{right}</div> : null}
        </div>
      ) : null}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function Grid({ cols = 4, children, className = '' }: { cols?: 2 | 3 | 4; children: ReactNode; className?: string }) {
  const map = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4' } as const;
  return <div className={`grid grid-cols-1 gap-3 ${map[cols]} ${className}`}>{children}</div>;
}

/* --------------------------------------------------------------------- atoms */

export function Kpi({
  label,
  value,
  detail,
  tone = 'default',
  testid,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: 'default' | 'teal' | 'saffron' | 'danger' | 'ok';
  testid?: string;
}) {
  const toneClass = {
    default: 'text-ink',
    teal: 'text-teal',
    saffron: 'text-saffron',
    danger: 'text-danger',
    ok: 'text-ok',
  }[tone];
  return (
    <div className="card card-pad flex min-w-0 flex-col justify-between" data-testid={testid}>
      <p className="label truncate" title={label}>
        {label}
      </p>
      <p className={`num mt-1 break-words text-[1.35rem] font-extrabold leading-tight tracking-tight sm:text-2xl ${toneClass}`} data-testid={testid ? `${testid}-value` : undefined}>
        {value}
      </p>
      {detail ? <p className="mt-1.5 text-2xs leading-relaxed text-faint">{detail}</p> : null}
    </div>
  );
}

const SEV_TONE: Record<string, string> = {
  critical: 'border-danger/50 bg-danger/10 text-danger',
  high: 'border-warn/50 bg-warn/10 text-warn',
  medium: 'border-teal/50 bg-teal/10 text-teal',
  low: 'border-line bg-raised text-muted',
  open: 'border-saffron/50 bg-saffron/10 text-saffron',
  acknowledged: 'border-ok/50 bg-ok/10 text-ok',
  dismissed: 'border-line bg-raised text-faint',
  valid: 'border-ok/50 bg-ok/10 text-ok',
  broken: 'border-danger/50 bg-danger/10 text-danger',
};

export function Badge({ children, kind, testid }: { children: ReactNode; kind?: string; testid?: string }) {
  const tone = (kind && SEV_TONE[kind.toLowerCase()]) || 'border-line bg-raised text-muted';
  return (
    <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wide ${tone}`} data-testid={testid}>
      {children}
    </span>
  );
}

export function Formula({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div data-testid="formula">
      {label ? <p className="label">{label}</p> : null}
      <p className="formula">{children}</p>
    </div>
  );
}

export function Meter({ pct, tone = 'teal' }: { pct: number; tone?: 'teal' | 'saffron' | 'danger' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const bg = { teal: 'bg-teal', saffron: 'bg-saffron', danger: 'bg-danger' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60" role="presentation">
      <div className={`h-full rounded-full ${bg}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function RunButton({ onClick, loading, label = 'Re-run', testid = 'run-button' }: { onClick: () => void; loading?: boolean; label?: string; testid?: string }) {
  return (
    <button type="button" className="btn" onClick={onClick} disabled={loading} data-testid={testid}>
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
      {loading ? 'Running…' : label}
    </button>
  );
}

/* -------------------------------------------------------------------- tables */

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  width?: string;
  render?: (row: T) => ReactNode;
  title?: (row: T) => string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  testid,
  maxHeight = '28rem',
  dense = false,
  onRowClick,
  rowTestid,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  testid?: string;
  maxHeight?: string;
  dense?: boolean;
  onRowClick?: (row: T) => void;
  rowTestid?: (row: T, i: number) => string;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight }} data-testid={testid}>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-raised">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''}`} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={`border-t border-line/60 hover:bg-raised/60 ${onRowClick ? 'cursor-pointer' : ''}`}
              data-testid={rowTestid ? rowTestid(row, i) : testid ? `${testid}-row` : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`td num ${dense ? 'py-1.5' : ''} ${c.align === 'right' ? 'text-right' : ''}`}
                  title={c.title ? c.title(row) : undefined}
                >
                  {c.render ? c.render(row) : fmtCell(c.key, (row as Record<string, unknown>)[c.key] as never)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Raw dataset rows, formatted per column convention — never raw JSON. */
export function RowTable({ columns, rows, testid }: { columns: string[]; rows: Record<string, unknown>[]; testid?: string }) {
  return (
    <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: '26rem' }} data-testid={testid}>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-raised">
          <tr>
            {columns.map((c) => (
              <th key={c} className="th">
                {humanise(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line/60 hover:bg-raised/60">
              {columns.map((c) => {
                const text = fmtCell(c, row[c]);
                return (
                  <td key={c} className="td num max-w-[16rem] truncate" title={text}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Definition list used for "every number explainable" panels. */
export function KeyValues({ items, cols = 2 }: { items: { k: string; v: ReactNode; title?: string }[]; cols?: 1 | 2 | 3 }) {
  const grid = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3' }[cols];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-2.5 ${grid}`} data-testid="key-values">
      {items.map((it) => (
        <div key={it.k} className="min-w-0 border-b border-line/50 pb-2">
          <dt className="label truncate" title={it.k}>
            {it.k}
          </dt>
          <dd className="num break-words text-sm font-semibold text-ink" title={it.title}>
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
