/**
 * SQLite access layer. Single synchronous connection (better-sqlite3), file
 * `data.db` at the project root, schema created idempotently on boot.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the project root by walking up to the directory holding package.json,
 * so `data.db` lives beside it whether the server runs from source (tsx) or from
 * the compiled `dist/` tree.
 */
function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** Absolute project root, used for data.db, seed/ and client/dist lookups. */
export const ROOT = projectRoot();

export const DB_PATH = process.env.DB_PATH || path.resolve(ROOT, 'data.db');

export const db: Database.Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    role         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt         TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS datasets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    domain        TEXT NOT NULL,
    description   TEXT NOT NULL,
    source_file   TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    row_count     INTEGER NOT NULL DEFAULT 0,
    column_count  INTEGER NOT NULL DEFAULT 0,
    reject_count  INTEGER NOT NULL DEFAULT 0,
    pii_columns   INTEGER NOT NULL DEFAULT 0,
    salt          TEXT NOT NULL,
    quality_score REAL NOT NULL DEFAULT 0,
    ingested_at   TEXT NOT NULL,
    ingested_by   TEXT NOT NULL,
    duration_ms   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS dataset_columns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id    INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    raw_name      TEXT NOT NULL,
    name          TEXT NOT NULL,
    inferred_type TEXT NOT NULL,
    type_confidence REAL NOT NULL,
    semantic_role TEXT NOT NULL,
    is_pii        INTEGER NOT NULL DEFAULT 0,
    pii_kind      TEXT,
    null_count    INTEGER NOT NULL DEFAULT 0,
    imputed_count INTEGER NOT NULL DEFAULT 0,
    impute_method TEXT,
    distinct_count INTEGER NOT NULL DEFAULT 0,
    min_value     TEXT,
    max_value     TEXT,
    mean_value    REAL,
    stddev_value  REAL
  );

  CREATE TABLE IF NOT EXISTS lineage_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id  INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    step_no     INTEGER NOT NULL,
    step        TEXT NOT NULL,
    status      TEXT NOT NULL,
    rows_in     INTEGER NOT NULL,
    rows_out    INTEGER NOT NULL,
    detail      TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingest_rejects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id  INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    source_line INTEGER NOT NULL,
    reason_code TEXT NOT NULL,
    reason      TEXT NOT NULL,
    raw_row     TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS anomalies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id    INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    dataset_slug  TEXT NOT NULL,
    source_row_id INTEGER NOT NULL,
    column_name   TEXT NOT NULL,
    entity        TEXT NOT NULL,
    period        TEXT,
    value         REAL NOT NULL,
    expected_low  REAL NOT NULL,
    expected_high REAL NOT NULL,
    deviation     REAL NOT NULL,
    sigma         REAL NOT NULL,
    method        TEXT NOT NULL,
    methods_agree INTEGER NOT NULL,
    severity      TEXT NOT NULL,
    score         REAL NOT NULL,
    explanation   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open',
    detected_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policy_cards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    department    TEXT NOT NULL,
    district      TEXT NOT NULL,
    sector        TEXT NOT NULL,
    impact_score  REAL NOT NULL,
    cost_cr       REAL NOT NULL,
    beneficiaries INTEGER NOT NULL,
    action        TEXT NOT NULL,
    rationale     TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    sdg_json      TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    seq          INTEGER NOT NULL,
    ts           TEXT NOT NULL,
    actor        TEXT NOT NULL,
    actor_role   TEXT NOT NULL,
    action       TEXT NOT NULL,
    entity       TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_hash    TEXT NOT NULL,
    hash         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_anom_ds ON anomalies(dataset_id);
  CREATE INDEX IF NOT EXISTS idx_anom_status ON anomalies(status);
  CREATE INDEX IF NOT EXISTS idx_lineage_ds ON lineage_steps(dataset_id);
  CREATE INDEX IF NOT EXISTS idx_rejects_ds ON ingest_rejects(dataset_id);
  CREATE INDEX IF NOT EXISTS idx_audit_seq ON audit_log(seq);
  `);
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

/** Guard against SQL injection when interpolating dynamic table/column names. */
export function safeIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}
