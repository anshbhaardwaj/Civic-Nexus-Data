/**
 * Auth: scrypt password hashing + hand-rolled HS256 JWT (node:crypto only).
 * No external auth libraries, no network.
 */
import crypto from 'node:crypto';
import { db } from '../db';

export type Role = 'minister' | 'analyst' | 'director' | 'auditor';

export const ROLES: Role[] = ['minister', 'analyst', 'director', 'auditor'];

const JWT_SECRET =
  process.env.JWT_SECRET || 'civicdata-nexus-offline-demo-secret-2026-sih1682';
const TOKEN_TTL_SECONDS = 60 * 60 * 8;

/* ------------------------------------------------------------ passwords */

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, salt: s };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ----------------------------------------------------------------- JWT */

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface JwtPayload {
  sub: number;
  email: string;
  name: string;
  role: Role;
  iat: number;
  exp: number;
}

export function signToken(user: { id: number; email: string; name: string; role: Role }): {
  token: string;
  expiresAt: string;
} {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role, iat, exp };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest());
  return { token: `${head}.${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!ROLES.includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ permission map */

/**
 * Permission catalogue. Every route declares one permission; roles map to sets.
 * (SPEC §2.)
 */
export const PERMISSIONS = [
  'dashboard.view',
  'datasets.read',
  'datasets.ingest',
  'datasets.delete',
  'datasets.export',
  'lineage.read',
  'anomalies.read',
  'anomalies.write',
  'ai.run',
  'policy.read',
  'funds.optimise',
  'simulate.run',
  'brief.read',
  'ask.run',
  'audit.read',
  'audit.export',
  'users.admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  minister: [
    'dashboard.view',
    'datasets.read',
    'lineage.read',
    'anomalies.read',
    'policy.read',
    'funds.optimise',
    'simulate.run',
    'brief.read',
    'ask.run',
  ],
  analyst: [
    'dashboard.view',
    'datasets.read',
    'datasets.ingest',
    'datasets.delete',
    'datasets.export',
    'lineage.read',
    'anomalies.read',
    'anomalies.write',
    'ai.run',
    'policy.read',
    'funds.optimise',
    'simulate.run',
    'brief.read',
    'ask.run',
    'audit.read',
  ],
  director: [
    'dashboard.view',
    'datasets.read',
    'datasets.export',
    'lineage.read',
    'anomalies.read',
    'anomalies.write',
    'ai.run',
    'policy.read',
    'funds.optimise',
    'simulate.run',
    'brief.read',
    'ask.run',
    'audit.read',
    'users.admin',
  ],
  auditor: [
    'dashboard.view',
    'datasets.read',
    'datasets.export',
    'lineage.read',
    'anomalies.read',
    'brief.read',
    'audit.read',
    'audit.export',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/* --------------------------------------------------------- user access */

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  salt: string;
  active: number;
  created_at: string;
}

export const DEMO_USERS: { email: string; name: string; role: Role; password: string }[] = [
  { email: 'minister@gov.in', name: 'Hon. Minister (Demo)', role: 'minister', password: 'Demo@1234' },
  { email: 'analyst@gov.in', name: 'Data Analyst (Demo)', role: 'analyst', password: 'Demo@1234' },
  { email: 'director@gov.in', name: 'Programme Director (Demo)', role: 'director', password: 'Demo@1234' },
  { email: 'auditor@gov.in', name: 'CAG Auditor (Demo)', role: 'auditor', password: 'Demo@1234' },
];

export function seedUsers(): number {
  let created = 0;
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO users(email, name, role, password_hash, salt, active, created_at) VALUES(?,?,?,?,?,1,?)`,
  );
  for (const u of DEMO_USERS) {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (exists) continue;
    const { hash, salt } = hashPassword(u.password);
    insert.run(u.email, u.name, u.role, hash, salt, now);
    created++;
  }
  return created;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as UserRow | undefined;
}
