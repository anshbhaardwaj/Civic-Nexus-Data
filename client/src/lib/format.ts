/**
 * The single number-formatting helper for the whole UI (SPEC §8).
 *
 * Rules enforced here so they can never drift per-page:
 *  - Indian magnitude suffixes: 2.8K / 1.4L / 3.2Cr.
 *  - `fmtCr` is the *only* place a ₹ symbol and the "cr" unit are emitted, so a
 *    value that is already in ₹ crore can never render as "₹₹" or "cr cr".
 *  - Any value that arrives pre-formatted from the API (e.g. brief KPIs return
 *    "₹1,28,566.86 cr") must go through `fmtMoneyish`, which passes strings
 *    straight through instead of decorating them a second time.
 */

const NBSP = '\u00A0';

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 2.8K / 1.4L / 3.2Cr — bare magnitude, no currency, no unit. */
export function fmtCompact(value: number | null | undefined, digits = 1): string {
  if (!isNum(value)) return '—';
  const neg = value < 0;
  const n = Math.abs(value);
  let out: string;
  if (n >= 1e7) out = `${trim(n / 1e7, digits)}Cr`;
  else if (n >= 1e5) out = `${trim(n / 1e5, digits)}L`;
  else if (n >= 1e3) out = `${trim(n / 1e3, digits)}K`;
  else out = trim(n, n < 10 && !Number.isInteger(n) ? 2 : n < 100 && !Number.isInteger(n) ? 1 : 0);
  return neg ? `-${out}` : out;
}

/** Counts (rows, beneficiaries, calls): compact above 10,000, grouped below. */
export function fmtCount(value: number | null | undefined): string {
  if (!isNum(value)) return '—';
  if (Math.abs(value) < 10000) return groupIN(Math.round(value));
  return fmtCompact(value);
}

/**
 * Money. `value` is ALWAYS a figure already expressed in ₹ crore (the API's
 * `*_cr` fields). Emits exactly one ₹ and exactly one "cr".
 */
export function fmtCr(value: number | null | undefined): string {
  if (!isNum(value)) return '—';
  const neg = value < 0;
  const n = Math.abs(value);
  const mag = n >= 1e5 ? `${trim(n / 1e5, 2)}L` : n >= 1e3 ? `${trim(n / 1e3, 1)}K` : trim(n, n < 100 ? 2 : 1);
  return `${neg ? '-' : ''}₹${mag}${NBSP}cr`;
}

/** Money in absolute rupees (not crore) — used for cost-per-outcome style figures. */
export function fmtRupees(value: number | null | undefined): string {
  if (!isNum(value)) return '—';
  const neg = value < 0;
  return `${neg ? '-' : ''}₹${fmtCompact(Math.abs(value), 2)}`;
}

/** Percentages. Input is already 0-100 unless `fraction` is set. */
export function fmtPct(value: number | null | undefined, digits = 1, fraction = false): string {
  if (!isNum(value)) return '—';
  return `${trim(fraction ? value * 100 : value, digits)}%`;
}

/** Chart axis ticks: short, no currency, no unit (the axis label carries those). */
export function fmtAxis(value: number | string | null | undefined): string {
  if (typeof value === 'string') return value;
  if (!isNum(value)) return '';
  return fmtCompact(value, Math.abs(value) < 1000 ? 1 : 1);
}

/** Plain decimal with a fixed precision, grouped in the Indian system. */
export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (!isNum(value)) return '—';
  const r = Number(value.toFixed(digits));
  return Number.isInteger(r) ? groupIN(r) : groupIN(r, digits);
}

export function fmtSigma(value: number | null | undefined): string {
  if (!isNum(value)) return '—';
  return `${trim(value, 2)}σ`;
}

/**
 * Renders a field that may already be a formatted string from the API. Strings
 * are returned untouched — this is what keeps "₹1,28,566.86 cr" from becoming
 * "₹₹1,28,566.86 cr cr".
 */
export function fmtMoneyish(value: number | string | null | undefined): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  return fmtCr(value ?? null);
}

/**
 * Formats any dataset cell for a table: numbers by column-name convention,
 * everything else as text (truncation is handled in CSS, not here).
 */
export function fmtCell(column: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  // SQLite hands some aggregates back as numeric strings; treat them as numbers
  // so a column's min/max never escapes the formatter as a raw 7-digit string.
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return fmtCell(column, Number(value));
  if (typeof value === 'number') {
    const c = column.toLowerCase();
    if (c.endsWith('_cr') || c.endsWith('cost_cr')) return fmtCr(value);
    if (c.endsWith('_pct') || c.includes('utilisation')) return fmtPct(value);
    if (Number.isInteger(value)) return fmtCount(value);
    if (Math.abs(value) >= 10000) return fmtCompact(value, 2);
    return fmtNum(value, 2);
  }
  return String(value);
}

/** ISO timestamp → "15 Aug 2026, 22:53" (no locale surprises in screenshots). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(iso: string | null | undefined): string {
  const full = fmtDateTime(iso);
  return full === '—' ? full : full.split(',')[0];
}

/** snake_case column → "Avg response min" for headers and labels. */
export function humanise(key: string): string {
  const s = key
    .replace(/_/g, ' ')
    .replace(/\bcr\b/gi, 'cr')
    .replace(/\bpct\b/gi, '%')
    .replace(/\bp90\b/gi, 'p90')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Unit hint shown next to a metric name, derived from the column convention. */
export function metricUnit(metric: string): string {
  const m = metric.toLowerCase();
  if (m.endsWith('_cr')) return '₹ crore';
  if (m.endsWith('_pct')) return '%';
  if (m.includes('_min')) return 'minutes';
  if (m.includes('index') || m.includes('rating') || m.includes('score')) return 'index';
  return 'count';
}

/** Truncates to a hard character budget with a real ellipsis (no clipped text). */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function trim(n: number, digits: number): string {
  const fixed = n.toFixed(digits);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Indian digit grouping: 12,34,567. */
function groupIN(n: number, digits = 0): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const [i, f] = abs.toFixed(digits).split('.');
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}${grouped}${f ? `.${f}` : ''}`;
}

/**
 * Server-generated prose (simulator headline, brief notes, budget derivation)
 * sometimes embeds raw money like "₹128566.86 cr". Rewrite every such token
 * through `fmtCr` so the whole UI reads in one money format and no long
 * unformatted figure ever reaches the screen. Idempotent: already-compact
 * tokens such as "₹1.29L cr" are left alone.
 */
export function prettifyMoney(text: string): string {
  return text.replace(/₹\s?([0-9][0-9,]*(?:\.[0-9]+)?)(\s?(?:cr|crore))?/gi, (whole, num: string, suffix?: string) => {
    const n = Number(num.replace(/,/g, ''));
    if (!Number.isFinite(n)) return whole;
    return suffix ? fmtCr(n) : fmtRupees(n);
  });
}
