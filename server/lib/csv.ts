/**
 * Delimiter- and quote-aware CSV/TSV/JSON parser (ingestion step 1).
 * Hand-rolled: RFC4180 quoting, escaped double quotes, CRLF tolerance,
 * automatic delimiter sniffing across , ; \t and |.
 */

export interface ParsedTable {
  header: string[];
  rows: string[][];
  delimiter: string;
  format: 'csv' | 'json';
  ragged: { line: number; got: number; want: number; raw: string }[];
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

export function sniffDelimiter(sample: string): string {
  const firstLines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 5);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    const counts = firstLines.map((l) => splitLine(l, d).length);
    if (!counts.length) continue;
    const consistent = counts.every((c) => c === counts[0]) ? 1 : 0;
    const score = counts[0] * 10 + consistent * 5;
    if (counts[0] > 1 && score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Splits raw text into logical records, respecting quoted newlines. */
function logicalLines(text: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function parseTable(text: string, hint?: 'csv' | 'json'): ParsedTable {
  const trimmed = text.trim();
  const isJson = hint === 'json' || (hint !== 'csv' && (trimmed.startsWith('[') || trimmed.startsWith('{')));
  if (isJson) return parseJsonTable(trimmed);
  const delimiter = sniffDelimiter(trimmed);
  const lines = logicalLines(trimmed).filter((l) => l.trim().length > 0);
  if (!lines.length) return { header: [], rows: [], delimiter, format: 'csv', ragged: [] };
  const header = splitLine(lines[0], delimiter).map((h) => h.trim());
  const rows: string[][] = [];
  const ragged: ParsedTable['ragged'] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    if (cells.length !== header.length) {
      ragged.push({ line: i + 1, got: cells.length, want: header.length, raw: lines[i].slice(0, 500) });
      continue;
    }
    rows.push(cells.map((c) => c.trim()));
  }
  return { header, rows, delimiter, format: 'csv', ragged };
}

function parseJsonTable(text: string): ParsedTable {
  const parsed = JSON.parse(text) as unknown;
  const arr = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed && Array.isArray((parsed as { rows?: unknown[] }).rows)
      ? ((parsed as { rows: unknown[] }).rows)
      : [parsed];
  const keys: string[] = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      for (const k of Object.keys(item as Record<string, unknown>)) if (!keys.includes(k)) keys.push(k);
    }
  }
  const rows = arr.map((item) =>
    keys.map((k) => {
      const val = (item as Record<string, unknown>)?.[k];
      return val === null || val === undefined ? '' : String(val);
    }),
  );
  return { header: keys, rows, delimiter: 'json', format: 'json', ragged: [] };
}
