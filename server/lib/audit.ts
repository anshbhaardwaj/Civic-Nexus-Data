/**
 * Append-only audit chain (SPEC §6).
 * hash = SHA256(prevHash | seq | ts | actor | action | entity | payloadHash)
 */
import crypto from 'node:crypto';
import { db } from '../db';

export const GENESIS_HASH = '0'.repeat(64);

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface AuditInput {
  actor: string;
  actorRole: string;
  action: string;
  entity: string;
  payload?: unknown;
}

export interface AuditRow {
  id: number;
  seq: number;
  ts: string;
  actor: string;
  actor_role: string;
  action: string;
  entity: string;
  payload_json: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
}

export function computeHash(
  prevHash: string,
  seq: number,
  ts: string,
  actor: string,
  action: string,
  entity: string,
  payloadHash: string,
): string {
  return sha256([prevHash, seq, ts, actor, action, entity, payloadHash].join('|'));
}

export function appendAudit(input: AuditInput): AuditRow {
  const last = db.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string }
    | undefined;
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const ts = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload ?? {});
  const payloadHash = sha256(payloadJson);
  const hash = computeHash(prevHash, seq, ts, input.actor, input.action, input.entity, payloadHash);
  const info = db
    .prepare(
      `INSERT INTO audit_log(seq, ts, actor, actor_role, action, entity, payload_json, payload_hash, prev_hash, hash)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(seq, ts, input.actor, input.actorRole, input.action, input.entity, payloadJson, payloadHash, prevHash, hash);
  return {
    id: Number(info.lastInsertRowid),
    seq,
    ts,
    actor: input.actor,
    actor_role: input.actorRole,
    action: input.action,
    entity: input.entity,
    payload_json: payloadJson,
    payload_hash: payloadHash,
    prev_hash: prevHash,
    hash,
  };
}

export interface VerifyResult {
  valid: boolean;
  entries: number;
  brokenAt: number | null;
  reason: string | null;
  headHash: string | null;
  algorithm: string;
}

/** Walks the entire chain: link continuity, payload integrity and hash recomputation. */
export function verifyChain(): VerifyResult {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all() as AuditRow[];
  const algorithm = 'SHA256(prevHash|seq|ts|actor|action|entity|payloadHash)';
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.seq !== i + 1) {
      return { valid: false, entries: rows.length, brokenAt: r.seq, reason: `sequence gap at seq ${r.seq}`, headHash: null, algorithm };
    }
    if (r.prev_hash !== prev) {
      return { valid: false, entries: rows.length, brokenAt: r.seq, reason: `prev_hash mismatch at seq ${r.seq}`, headHash: null, algorithm };
    }
    if (sha256(r.payload_json) !== r.payload_hash) {
      return { valid: false, entries: rows.length, brokenAt: r.seq, reason: `payload tampered at seq ${r.seq}`, headHash: null, algorithm };
    }
    const expect = computeHash(r.prev_hash, r.seq, r.ts, r.actor, r.action, r.entity, r.payload_hash);
    if (expect !== r.hash) {
      return { valid: false, entries: rows.length, brokenAt: r.seq, reason: `hash mismatch at seq ${r.seq}`, headHash: null, algorithm };
    }
    prev = r.hash;
  }
  return {
    valid: true,
    entries: rows.length,
    brokenAt: null,
    reason: null,
    headHash: rows.length ? rows[rows.length - 1].hash : GENESIS_HASH,
    algorithm,
  };
}
