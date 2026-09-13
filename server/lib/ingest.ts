/**
 * The 10-step ingestion pipeline (SPEC §4).
 *
 *  1. parse (CSV/JSON, delimiter + quote aware)
 *  2. header normalisation (trim -> snake_case, dedupe collisions)
 *  3. type inference (integer/number/date/boolean/string) with confidence
 *  4. semantic role inference (dimension/metric/time/identifier/pii)
 *  5. PII detection (name, phone, email, Aadhaar-like, address)
 *  6. PII masking (salted SHA-256 -> base36 token starting with a letter)
 *  7. missing-value imputation (numeric median / categorical mode / time ffill)
 *  8. deduplication (identifier or full-row hash)
 *  9. schema validation, rejects with reasons -> ingest_rejects
 * 10. persist to ds_<slug> + lineage_steps + audit_log
 *
 * Every step appends a lineage row with rows_in / rows_out / detail JSON.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, safeIdent } from '../db';
import { appendAudit } from './audit';
import { parseTable } from './csv';
import { SEED_DIR, SEED_FILES, generateSeedFiles } from './seedgen';
import { mean as avg, median, mode, stddev } from './stats';

export type ColType = 'integer' | 'number' | 'date' | 'boolean' | 'string';
export type SemanticRole = 'dimension' | 'metric' | 'time' | 'identifier' | 'pii';
export type PiiKind = 'name' | 'phone' | 'email' | 'aadhaar' | 'address' | null;

export interface ColumnPlan {
  ordinal: number;
  rawName: string;
  name: string;
  type: ColType;
  typeConfidence: number;
  role: SemanticRole;
  isPii: boolean;
  piiKind: PiiKind;
  nullCount: number;
  imputedCount: number;
  imputeMethod: string | null;
  distinctCount: number;
  min: string | null;
  max: string | null;
  meanValue: number | null;
  stddevValue: number | null;
}

export interface IngestOptions {
  slug: string;
  name: string;
  domain: string;
  description: string;
  sourceFile: string;
  actor: string;
  actorRole: string;
  /** re-ingest even when the dataset already exists */
  replace?: boolean;
}

export interface IngestResult {
  datasetId: number;
  slug: string;
  tableName: string;
  rows: number;
  columns: number;
  rejects: number;
  piiColumns: number;
  qualityScore: number;
  durationMs: number;
  steps: { step: string; status: string; rowsIn: number; rowsOut: number; detail: Record<string, unknown> }[];
}

/* ------------------------------------------------------- step 2 helpers */

export function snakeCase(raw: string): string {
  const s = raw
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  const cleaned = s.length ? s : 'column';
  return /^[a-z_]/.test(cleaned) ? cleaned : `c_${cleaned}`;
}

function normaliseHeaders(header: string[]): { names: string[]; collisions: { from: string; to: string }[] } {
  const seen = new Map<string, number>();
  const names: string[] = [];
  const collisions: { from: string; to: string }[] = [];
  header.forEach((h, i) => {
    let base = snakeCase(h || `column_${i + 1}`);
    if (base === 'row_id' || base.startsWith('_')) base = `col_${base.replace(/^_+/, '')}`;
    if (seen.has(base)) {
      const n = (seen.get(base) ?? 1) + 1;
      seen.set(base, n);
      const renamed = `${base}_${n}`;
      collisions.push({ from: h, to: renamed });
      names.push(renamed);
    } else {
      seen.set(base, 1);
      names.push(base);
    }
  });
  return { names, collisions };
}

/* ------------------------------------------------------------ step 3/4 */

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const FY_RE = /^\d{4}-\d{2}$/;
const INT_RE = /^-?\d+$/;
const NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const BOOL_VALUES = new Set(['true', 'false', 'yes', 'no', '0', '1', 'y', 'n']);

export function inferType(values: string[]): { type: ColType; confidence: number } {
  const nonEmpty = values.filter((v) => v !== '' && v != null);
  if (!nonEmpty.length) return { type: 'string', confidence: 0.5 };
  let ints = 0;
  let nums = 0;
  let dates = 0;
  let bools = 0;
  for (const v of nonEmpty) {
    if (INT_RE.test(v)) ints++;
    if (NUM_RE.test(v)) nums++;
    if (DATE_RE.test(v)) dates++;
    if (BOOL_VALUES.has(v.toLowerCase())) bools++;
  }
  const n = nonEmpty.length;
  // A financial-year style "2019-20" must not be typed as a date.
  const fyLike = nonEmpty.filter((v) => FY_RE.test(v) && Number(v.slice(5)) > 12).length;
  const dateRatio = (dates - fyLike) / n;
  const candidates: { type: ColType; ratio: number }[] = [
    { type: 'integer', ratio: ints / n },
    { type: 'number', ratio: nums / n },
    { type: 'date', ratio: dateRatio },
    { type: 'boolean', ratio: bools / n === 1 && new Set(nonEmpty.map((v) => v.toLowerCase())).size <= 2 ? 1 : 0 },
  ];
  if (candidates[3].ratio >= 0.99) return { type: 'boolean', confidence: 0.99 };
  if (candidates[2].ratio >= 0.95) return { type: 'date', confidence: Math.min(0.99, candidates[2].ratio) };
  if (candidates[0].ratio >= 0.95) return { type: 'integer', confidence: Math.min(0.99, candidates[0].ratio) };
  if (candidates[1].ratio >= 0.95) return { type: 'number', confidence: Math.min(0.99, candidates[1].ratio) };
  const best = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  if (best.ratio >= 0.6) return { type: best.type, confidence: Math.max(0.6, best.ratio * 0.9) };
  return { type: 'string', confidence: Math.min(0.95, 1 - best.ratio) };
}

const ID_NAME_RE = /(^|_)(id|ticket_id|code|ref_no|bridge_id|uid)$/;
const TIME_NAME_RE = /(^|_)(month|date|fy|year|period|opened_on|closed_on|last_inspection|timestamp|ts)$/;

export function inferRole(name: string, type: ColType, distinct: number, rows: number, isPii: boolean): SemanticRole {
  if (isPii) return 'pii';
  if (ID_NAME_RE.test(name) && distinct >= rows * 0.9) return 'identifier';
  if (type === 'date' || TIME_NAME_RE.test(name)) return 'time';
  if (type === 'integer' || type === 'number') {
    // low-cardinality integers that look like codes/years behave as dimensions
    if (/(^|_)(year|year_built)$/.test(name)) return 'dimension';
    return 'metric';
  }
  return 'dimension';
}

/* -------------------------------------------------------------- step 5 */

const PII_HEADER_PATTERNS: { kind: Exclude<PiiKind, null>; re: RegExp }[] = [
  { kind: 'email', re: /(e_?mail)/ },
  { kind: 'phone', re: /(phone|mobile|contact_no|msisdn)/ },
  { kind: 'aadhaar', re: /(aadhaar|aadhar|uidai|uid_no)/ },
  { kind: 'name', re: /(citizen_name|beneficiary_name|applicant_name|full_name|^name$|_name$)/ },
  { kind: 'address', re: /(address|addr|house_no|street|pin_?code)/ },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^(\+?91[-\s]?)?[6-9]\d{9}$/;
const AADHAAR_RE = /^\d{12}$/;
const NAME_RE = /^[A-Z][a-z]+(\s[A-Z][a-z]+){1,3}$/;
const ADDRESS_RE = /\d+[,\s].*(road|street|nagar|colony|marg|lane|sector)/i;

/** Headers that genuinely denote a person rather than a place or asset. */
const PERSON_HEADER_RE =
  /(citizen|applicant|beneficiary_name|complainant|person|patient|owner|father|mother|guardian|contact_person|officer_name|full_name|^name$|_name$)/;

export function detectPii(
  name: string,
  values: string[],
): { isPii: boolean; kind: PiiKind; evidence: string; matchRatio: number } {
  const sample = values.filter((v) => v !== '').slice(0, 300);
  const headerHit = PII_HEADER_PATTERNS.find((p) => p.re.test(name));
  const valueTests: { kind: Exclude<PiiKind, null>; re: RegExp }[] = [
    { kind: 'email', re: EMAIL_RE },
    { kind: 'phone', re: PHONE_RE },
    { kind: 'aadhaar', re: AADHAAR_RE },
    { kind: 'address', re: ADDRESS_RE },
    { kind: 'name', re: NAME_RE },
  ];
  let bestValue: { kind: Exclude<PiiKind, null>; ratio: number } | null = null;
  for (const t of valueTests) {
    if (!sample.length) break;
    const ratio = sample.filter((v) => t.re.test(v)).length / sample.length;
    if (ratio >= 0.6 && (!bestValue || ratio > bestValue.ratio)) bestValue = { kind: t.kind, ratio };
  }
  // A 12-digit column is only Aadhaar-like if the header does not say otherwise
  if (bestValue?.kind === 'aadhaar' && /(pcu|households|beneficiaries|vehicles|amount)/.test(name)) bestValue = null;
  /**
   * Two-word strings alone are not personal names — road corridors, scheme
   * names, districts and departments all look like "Word Word". Only accept a
   * value-only 'name' verdict when the header itself is person-oriented.
   */
  if (bestValue?.kind === 'name' && !PERSON_HEADER_RE.test(name)) bestValue = null;
  if (headerHit && bestValue) {
    return {
      isPii: true,
      kind: headerHit.kind,
      evidence: `header pattern /${headerHit.re.source}/ + ${Math.round(bestValue.ratio * 100)}% value match (${bestValue.kind})`,
      matchRatio: bestValue.ratio,
    };
  }
  if (headerHit) {
    return { isPii: true, kind: headerHit.kind, evidence: `header pattern /${headerHit.re.source}/`, matchRatio: 1 };
  }
  if (bestValue) {
    return {
      isPii: true,
      kind: bestValue.kind,
      evidence: `${Math.round(bestValue.ratio * 100)}% of sampled values match ${bestValue.kind} regex`,
      matchRatio: bestValue.ratio,
    };
  }
  return { isPii: false, kind: null, evidence: 'no header or value match', matchRatio: 0 };
}

/* -------------------------------------------------------------- step 6 */

/**
 * Salted SHA-256 pseudonymisation. Deterministic per (dataset salt, column,
 * value) so joins still work, irreversible, and always starts with a letter so
 * downstream consumers never mistake it for a number.
 */
export function maskValue(salt: string, column: string, value: string): string {
  if (value === '') return '';
  const digest = crypto.createHash('sha256').update(`${salt}|${column}|${value}`).digest();
  const big = BigInt('0x' + digest.subarray(0, 10).toString('hex'));
  const b36 = big.toString(36);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const first = letters[Number(BigInt(digest[10]) % 26n)];
  return `${first}${b36}`.slice(0, 14).toUpperCase();
}

/* ---------------------------------------------------------------- misc */

function rowHash(cells: string[]): string {
  return crypto.createHash('sha256').update(cells.join('\u0001')).digest('hex');
}

function sqlType(t: ColType): string {
  switch (t) {
    case 'integer':
      return 'INTEGER';
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

function coerce(t: ColType, v: string): string | number | null {
  if (v === '') return null;
  if (t === 'integer') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (t === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (t === 'boolean') return ['true', 'yes', 'y', '1'].includes(v.toLowerCase()) ? 1 : 0;
  return v;
}

/* ============================================================ pipeline */

export function ingestText(text: string, opts: IngestOptions, hint?: 'csv' | 'json'): IngestResult {
  const t0 = Date.now();
  const slug = snakeCase(opts.slug);
  const tableName = safeIdent(`ds_${slug}`);
  const steps: IngestResult['steps'] = [];
  const stepRows: { step: string; status: string; rowsIn: number; rowsOut: number; detail: string; ms: number }[] = [];
  const stepTimer = { last: t0 };
  const step = (name: string, rowsIn: number, rowsOut: number, detail: Record<string, unknown>, status = 'ok') => {
    const now = Date.now();
    steps.push({ step: name, status, rowsIn, rowsOut, detail });
    stepRows.push({ step: name, status, rowsIn, rowsOut, detail: JSON.stringify(detail), ms: now - stepTimer.last });
    stepTimer.last = now;
  };

  /* 1. parse ------------------------------------------------------------ */
  const parsed = parseTable(text, hint);
  if (!parsed.header.length) throw new Error('No header row found in source');
  step('parse', parsed.rows.length + parsed.ragged.length, parsed.rows.length, {
    format: parsed.format,
    delimiter: parsed.delimiter === '\t' ? '\\t' : parsed.delimiter,
    headerCells: parsed.header.length,
    raggedRows: parsed.ragged.length,
    note: 'RFC4180 quote-aware split; ragged rows deferred to step 9 rejects',
  });

  /* 2. header normalisation --------------------------------------------- */
  const { names, collisions } = normaliseHeaders(parsed.header);
  step('header_normalisation', parsed.rows.length, parsed.rows.length, {
    renamed: parsed.header.map((h, i) => ({ from: h, to: names[i] })).filter((x) => x.from !== x.to).slice(0, 20),
    collisionsResolved: collisions.length,
    rule: 'trim -> snake_case -> dedupe with _2 suffix',
  });

  const nCols = names.length;
  const columns: string[][] = names.map((_, c) => parsed.rows.map((r) => r[c] ?? ''));

  /* 3. type inference --------------------------------------------------- */
  const typed = columns.map((vals) => inferType(vals));
  step('type_inference', parsed.rows.length, parsed.rows.length, {
    columns: names.map((n, i) => ({ column: n, type: typed[i].type, confidence: Number(typed[i].confidence.toFixed(3)) })),
    method: 'regex vote per value; >=95% share wins, else best ratio with reduced confidence',
  });

  /* 5. PII detection (needed before role inference) ---------------------- */
  const pii = names.map((n, i) => detectPii(n, columns[i]));

  /* 4. semantic role inference ------------------------------------------ */
  const distincts = columns.map((vals) => new Set(vals).size);
  const roles = names.map((n, i) => inferRole(n, typed[i].type, distincts[i], parsed.rows.length, pii[i].isPii));
  step('semantic_role_inference', parsed.rows.length, parsed.rows.length, {
    columns: names.map((n, i) => ({ column: n, role: roles[i], distinct: distincts[i] })),
    method: 'name pattern + inferred type + cardinality ratio',
  });
  step('pii_detection', parsed.rows.length, parsed.rows.length, {
    piiColumns: names.filter((_, i) => pii[i].isPii).map((n, k) => {
      const i = names.indexOf(n);
      return { column: n, kind: pii[i].kind, evidence: pii[i].evidence };
    }),
    detectors: ['name', 'phone', 'email', 'aadhaar(12-digit)', 'address'],
  });

  /* 6. PII masking ------------------------------------------------------ */
  const salt = crypto.randomBytes(16).toString('hex');
  let maskedCells = 0;
  for (let c = 0; c < nCols; c++) {
    if (!pii[c].isPii) continue;
    for (let r = 0; r < columns[c].length; r++) {
      if (columns[c][r] === '') continue;
      columns[c][r] = maskValue(salt, names[c], columns[c][r]);
      maskedCells++;
    }
    typed[c] = { type: 'string', confidence: 1 };
  }
  step('pii_masking', parsed.rows.length, parsed.rows.length, {
    algorithm: 'token = base36(SHA256(datasetSalt|column|value)[0..10]) prefixed with a derived letter, uppercased',
    saltBits: 128,
    saltStored: 'per-dataset random salt kept only to reproduce joins; original values never persisted',
    columnsMasked: names.filter((_, i) => pii[i].isPii),
    cellsMasked: maskedCells,
  });

  /* 7. imputation ------------------------------------------------------- */
  const imputed: number[] = new Array(nCols).fill(0);
  const imputeMethods: (string | null)[] = new Array(nCols).fill(null);
  const nullCounts: number[] = new Array(nCols).fill(0);
  for (let c = 0; c < nCols; c++) {
    const vals = columns[c];
    const missingIdx: number[] = [];
    for (let r = 0; r < vals.length; r++) if (vals[r] === '') missingIdx.push(r);
    nullCounts[c] = missingIdx.length;
    if (!missingIdx.length) continue;
    const t = typed[c].type;
    if (t === 'integer' || t === 'number') {
      const nums = vals.filter((v) => v !== '').map(Number).filter((n) => Number.isFinite(n));
      if (!nums.length) continue;
      const fill = t === 'integer' ? String(Math.round(median(nums))) : String(Number(median(nums).toFixed(4)));
      for (const r of missingIdx) vals[r] = fill;
      imputed[c] = missingIdx.length;
      imputeMethods[c] = `numeric median = ${fill}`;
    } else if (t === 'date') {
      let last = '';
      for (let r = 0; r < vals.length; r++) {
        if (vals[r] === '') {
          if (last) {
            vals[r] = last;
            imputed[c]++;
          }
        } else last = vals[r];
      }
      imputeMethods[c] = 'time forward-fill (last observation carried forward)';
    } else if (roles[c] === 'dimension') {
      const m = mode(vals.filter((v) => v !== ''));
      if (m == null) continue;
      for (const r of missingIdx) vals[r] = m;
      imputed[c] = missingIdx.length;
      imputeMethods[c] = `categorical mode = ${m}`;
    } else {
      imputeMethods[c] = 'left blank (identifier / pii column not imputed)';
    }
  }
  step('imputation', parsed.rows.length, parsed.rows.length, {
    columns: names
      .map((n, i) => ({ column: n, missing: nullCounts[i], imputed: imputed[i], method: imputeMethods[i] }))
      .filter((x) => x.missing > 0),
    totalImputed: imputed.reduce((a, b) => a + b, 0),
    rules: { numeric: 'median', categorical: 'mode', time: 'forward fill' },
  });

  /* 8. deduplication ---------------------------------------------------- */
  const idIndex = roles.findIndex((r) => r === 'identifier');
  const seen = new Set<string>();
  const keep: number[] = [];
  let dupes = 0;
  for (let r = 0; r < parsed.rows.length; r++) {
    const cells = names.map((_, c) => columns[c][r]);
    const key = idIndex >= 0 ? `id:${cells[idIndex]}` : `row:${rowHash(cells)}`;
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    keep.push(r);
  }
  step('deduplication', parsed.rows.length, keep.length, {
    strategy: idIndex >= 0 ? `identifier column '${names[idIndex]}'` : 'SHA-256 full-row hash',
    duplicatesRemoved: dupes,
  });

  /* 9. schema validation + rejects -------------------------------------- */
  interface Reject {
    line: number;
    code: string;
    reason: string;
    raw: string;
  }
  const rejects: Reject[] = parsed.ragged.map((r) => ({
    line: r.line,
    code: 'RAGGED_ROW',
    reason: `expected ${r.want} cells, found ${r.got}`,
    raw: r.raw,
  }));
  const validRows: number[] = [];
  for (const r of keep) {
    const cells = names.map((_, c) => columns[c][r]);
    let bad: string | null = null;
    for (let c = 0; c < nCols; c++) {
      const t = typed[c].type;
      const v = cells[c];
      if (v === '') {
        if (roles[c] === 'identifier') bad = `identifier column '${names[c]}' is empty`;
        continue;
      }
      if ((t === 'integer' || t === 'number') && !Number.isFinite(Number(v))) {
        bad = `column '${names[c]}' expected ${t}, got '${v.slice(0, 32)}'`;
        break;
      }
      if (t === 'date' && !DATE_RE.test(v)) {
        bad = `column '${names[c]}' expected date, got '${v.slice(0, 32)}'`;
        break;
      }
    }
    if (bad) rejects.push({ line: r + 2, code: 'SCHEMA_VIOLATION', reason: bad, raw: cells.join(',').slice(0, 500) });
    else validRows.push(r);
  }
  step('schema_validation', keep.length, validRows.length, {
    rejected: rejects.length,
    reasonCodes: Array.from(new Set(rejects.map((r) => r.code))),
    sample: rejects.slice(0, 5),
  });

  /* 10. persist --------------------------------------------------------- */
  const existing = db.prepare('SELECT id FROM datasets WHERE slug = ?').get(slug) as { id: number } | undefined;
  const now = new Date().toISOString();

  const persist = db.transaction(() => {
    if (existing) {
      db.prepare('DELETE FROM datasets WHERE id = ?').run(existing.id);
    }
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    const colDefs = names.map((n, i) => `${safeIdent(n)} ${sqlType(typed[i].type)}`);
    db.exec(`CREATE TABLE ${tableName} (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ${colDefs.join(', ')})`);

    const insert = db.prepare(
      `INSERT INTO ${tableName} (${names.map(safeIdent).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    );
    for (const r of validRows) {
      insert.run(names.map((_, c) => coerce(typed[c].type, columns[c][r])));
    }

    // column statistics
    const plans: ColumnPlan[] = names.map((n, i) => {
      const vals = validRows.map((r) => columns[i][r]).filter((v) => v !== '');
      const t = typed[i].type;
      let minV: string | null = null;
      let maxV: string | null = null;
      let meanV: number | null = null;
      let sdV: number | null = null;
      if (t === 'integer' || t === 'number') {
        const nums = vals.map(Number).filter(Number.isFinite);
        if (nums.length) {
          minV = String(Math.min(...nums));
          maxV = String(Math.max(...nums));
          meanV = Number(avg(nums).toFixed(4));
          sdV = Number(stddev(nums).toFixed(4));
        }
      } else if (vals.length) {
        const sorted = [...vals].sort();
        minV = sorted[0].slice(0, 64);
        maxV = sorted[sorted.length - 1].slice(0, 64);
      }
      return {
        ordinal: i,
        rawName: parsed.header[i],
        name: n,
        type: t,
        typeConfidence: Number(typed[i].confidence.toFixed(3)),
        role: roles[i],
        isPii: pii[i].isPii,
        piiKind: pii[i].kind,
        nullCount: nullCounts[i],
        imputedCount: imputed[i],
        imputeMethod: imputeMethods[i],
        distinctCount: new Set(vals).size,
        min: minV,
        max: maxV,
        meanValue: meanV,
        stddevValue: sdV,
      };
    });

    const totalCells = validRows.length * nCols || 1;
    const missingCells = nullCounts.reduce((a, b) => a + b, 0);
    const qualityScore = Number(
      (
        100 *
        (1 - missingCells / totalCells) *
        (1 - rejects.length / (parsed.rows.length + parsed.ragged.length || 1)) *
        (1 - dupes / (parsed.rows.length || 1))
      ).toFixed(1),
    );

    const info = db
      .prepare(
        `INSERT INTO datasets(slug, name, domain, description, source_file, table_name, row_count, column_count,
          reject_count, pii_columns, salt, quality_score, ingested_at, ingested_by, duration_ms)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        slug,
        opts.name,
        opts.domain,
        opts.description,
        opts.sourceFile,
        tableName,
        validRows.length,
        nCols,
        rejects.length,
        plans.filter((p) => p.isPii).length,
        salt,
        qualityScore,
        now,
        opts.actor,
        Date.now() - t0,
      );
    const datasetId = Number(info.lastInsertRowid);

    const colInsert = db.prepare(
      `INSERT INTO dataset_columns(dataset_id, ordinal, raw_name, name, inferred_type, type_confidence, semantic_role,
        is_pii, pii_kind, null_count, imputed_count, impute_method, distinct_count, min_value, max_value, mean_value, stddev_value)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const p of plans) {
      colInsert.run(
        datasetId, p.ordinal, p.rawName, p.name, p.type, p.typeConfidence, p.role, p.isPii ? 1 : 0, p.piiKind,
        p.nullCount, p.imputedCount, p.imputeMethod, p.distinctCount, p.min, p.max, p.meanValue, p.stddevValue,
      );
    }

    const rejInsert = db.prepare(
      `INSERT INTO ingest_rejects(dataset_id, source_line, reason_code, reason, raw_row, created_at) VALUES(?,?,?,?,?,?)`,
    );
    for (const r of rejects.slice(0, 2000)) rejInsert.run(datasetId, r.line, r.code, r.reason, r.raw, now);

    const lineageInsert = db.prepare(
      `INSERT INTO lineage_steps(dataset_id, step_no, step, status, rows_in, rows_out, detail, duration_ms, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    stepRows.forEach((s, i) => lineageInsert.run(datasetId, i + 1, s.step, s.status, s.rowsIn, s.rowsOut, s.detail, s.ms, now));
    // step 10 records itself
    lineageInsert.run(
      datasetId,
      stepRows.length + 1,
      'persist',
      'ok',
      validRows.length,
      validRows.length,
      JSON.stringify({
        table: tableName,
        columns: nCols,
        qualityScore,
        qualityFormula: '100 x (1 - missingCells/cells) x (1 - rejects/sourceRows) x (1 - dupes/parsedRows)',
      }),
      Date.now() - stepTimer.last,
      now,
    );

    return { datasetId, rows: validRows.length, rejects: rejects.length, qualityScore, piiCols: plans.filter((p) => p.isPii).length };
  });

  const out = persist();
  const durationMs = Date.now() - t0;
  db.prepare('UPDATE datasets SET duration_ms = ? WHERE id = ?').run(durationMs, out.datasetId);

  appendAudit({
    actor: opts.actor,
    actorRole: opts.actorRole,
    action: 'dataset.ingest',
    entity: `dataset:${slug}`,
    payload: {
      slug,
      sourceFile: opts.sourceFile,
      rows: out.rows,
      columns: nCols,
      rejects: out.rejects,
      piiColumnsMasked: out.piiCols,
      qualityScore: out.qualityScore,
      durationMs,
    },
  });

  steps.push({
    step: 'persist',
    status: 'ok',
    rowsIn: out.rows,
    rowsOut: out.rows,
    detail: { table: tableName, qualityScore: out.qualityScore },
  });

  return {
    datasetId: out.datasetId,
    slug,
    tableName,
    rows: out.rows,
    columns: nCols,
    rejects: out.rejects,
    piiColumns: out.piiCols,
    qualityScore: out.qualityScore,
    durationMs,
    steps,
  };
}

export function ingestFile(filePath: string, opts: Omit<IngestOptions, 'sourceFile'> & { sourceFile?: string }): IngestResult {
  const text = fs.readFileSync(filePath, 'utf8');
  const hint = filePath.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  return ingestText(text, { ...opts, sourceFile: opts.sourceFile ?? path.basename(filePath) }, hint);
}

/** Idempotent boot ingestion of all 8 seeded datasets through the real pipeline. */
export function ingestSeedDatasets(force = false): IngestResult[] {
  generateSeedFiles(false);
  const out: IngestResult[] = [];
  for (const spec of SEED_FILES) {
    const existing = db.prepare('SELECT id, row_count FROM datasets WHERE slug = ?').get(spec.slug) as
      | { id: number; row_count: number }
      | undefined;
    if (existing && existing.row_count > 0 && !force) continue;
    out.push(
      ingestFile(path.join(SEED_DIR, spec.file), {
        slug: spec.slug,
        name: spec.title,
        domain: spec.domain,
        description: spec.description,
        actor: 'system@civicnexus.in',
        actorRole: 'system',
      }),
    );
  }
  return out;
}
