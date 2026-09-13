/** /api/simulate, /api/live/tick, /api/brief/*, /api/audit/*, /api/users/*, /api/dashboard */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { anomalyCount } from '../ai/anomaly';
import { listPolicyCards, totalIdleCapitalCr } from '../ai/mcda';
import { runOptimiser } from '../ai/optimiser';
import { ROLE_PERMISSIONS, ROLES, Role, hashPassword } from '../lib/auth';
import { verifyChain } from '../lib/audit';
import { buildBrief } from '../lib/brief';
import { datasetSummary, listDatasets, mustDataset } from '../lib/datasets';
import { ApiError, asyncHandler, audit, requireAuth, requirePermission, v, validate } from '../lib/http';
import { liveTick } from '../lib/live';
import { renderBriefPdf } from '../lib/pdf';
import { DEFAULT_LEVERS, measureBaseline, simulate } from '../lib/simulate';

/* ----------------------------------------------------------- simulator */

export const simulateRouter = Router();
simulateRouter.use(requireAuth);

const leverSchema = z
  .object({
    budgetReallocationPct: z.coerce.number().min(0).max(100).optional(),
    hospitalBedsAdded: z.coerce.number().int().min(0).max(100_000).optional(),
    ambulancesAdded: z.coerce.number().int().min(0).max(20_000).optional(),
    staffHired: z.coerce.number().int().min(0).max(200_000).optional(),
    waterCapexPct: z.coerce.number().min(0).max(100).optional(),
    roadRepairCapexCr: z.coerce.number().min(0).max(100_000).optional(),
    enforcementIntensity: z.coerce.number().min(0).max(100).optional(),
  })
  .default({});

simulateRouter.post(
  '/',
  requirePermission('simulate.run'),
  validate({ body: leverSchema }),
  asyncHandler((req, res) => {
    const levers = v<z.infer<typeof leverSchema>>(req, 'body');
    const result = simulate(levers);
    audit(req, 'simulate.run', 'policy_simulator', { levers: result.levers, headline: result.headline });
    res.json(result);
  }),
);

simulateRouter.get(
  '/assumptions',
  requirePermission('simulate.run'),
  asyncHandler((_req, res) => {
    const base = simulate({});
    res.json({
      defaultLevers: DEFAULT_LEVERS,
      baseline: base.baseline,
      assumptions: base.assumptions,
      outputs: base.outputs.map((o) => ({ key: o.key, label: o.label, unit: o.unit, formula: o.formula })),
      horizonYears: base.horizonYears,
    });
  }),
);

/* ------------------------------------------------------ live simulator */

export const liveRouter = Router();
liveRouter.use(requireAuth);

liveRouter.post(
  '/tick',
  requirePermission('datasets.ingest'),
  validate({
    body: z
      .object({
        dataset: z.string().min(1).default('ambulance_response'),
        spikeProbability: z.coerce.number().min(0).max(1).optional(),
      })
      .default({ dataset: 'ambulance_response' }),
  }),
  asyncHandler((req, res) => {
    const body = v<{ dataset: string; spikeProbability?: number }>(req, 'body');
    const ds = mustDataset(body.dataset);
    const result = liveTick(ds, { spikeProbability: body.spikeProbability });
    audit(req, 'live.tick_request', `dataset:${ds.slug}`, { period: result.period, rowsAppended: result.rowsAppended });
    res.json({ ...result, note: 'Offline telemetry simulator: rows are appended to the ingested table and AI-1 is re-run.' });
  }),
);

/* --------------------------------------------------------------- brief */

export const briefRouter = Router();
briefRouter.use(requireAuth);

briefRouter.get(
  '/preview',
  requirePermission('brief.read'),
  asyncHandler((req, res) => {
    res.json(buildBrief(req.user!.email));
  }),
);

briefRouter.get(
  '/pdf',
  requirePermission('brief.read'),
  asyncHandler(async (req, res) => {
    const brief = buildBrief(req.user!.email);
    const pdf = await renderBriefPdf(brief);
    audit(req, 'brief.pdf', 'executive_brief', { bytes: pdf.length, datasets: brief.scope.datasets });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="civicdata-nexus-executive-brief.pdf"');
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  }),
);

/* --------------------------------------------------------------- audit */

export const auditRouter = Router();
auditRouter.use(requireAuth);

const auditQuery = z.object({
  action: z.string().max(60).optional(),
  actor: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

auditRouter.get(
  '/',
  requirePermission('audit.read'),
  validate({ query: auditQuery }),
  asyncHandler((req, res) => {
    const q = v<z.infer<typeof auditQuery>>(req, 'query');
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.action) {
      where.push('action LIKE ?');
      params.push(`%${q.action}%`);
    }
    if (q.actor) {
      where.push('actor LIKE ?');
      params.push(`%${q.actor}%`);
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log${clause}`).get(...params) as { n: number }).n;
    const rows = db
      .prepare(`SELECT * FROM audit_log${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, q.limit, q.offset);
    res.json({ total, limit: q.limit, offset: q.offset, entries: rows });
  }),
);

auditRouter.get(
  '/verify',
  requirePermission('audit.read'),
  asyncHandler((_req, res) => {
    const result = verifyChain();
    res.json({
      ...result,
      method: 'hash_i = SHA-256(prev_hash || id || ts || actor || role || action || entity || payload_json)',
    });
  }),
);

auditRouter.get(
  '/export',
  requirePermission('audit.export'),
  asyncHandler((req, res) => {
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as Record<string, unknown>[];
    const verification = verifyChain();
    audit(req, 'audit.export', 'audit_log', { entries: rows.length });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="civicdata-nexus-audit-log.json"');
    res.end(
      JSON.stringify(
        { exportedAt: new Date().toISOString(), exportedBy: req.user!.email, verification, entries: rows },
        null,
        2,
      ),
    );
  }),
);

/* --------------------------------------------------------------- users */

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get(
  '/',
  requirePermission('users.admin'),
  asyncHandler((_req, res) => {
    const rows = db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY id').all() as
      | { id: number; email: string; name: string; role: Role; active: number; created_at: string }[];
    res.json({ users: rows.map((u) => ({ ...u, active: !!u.active, permissions: ROLE_PERMISSIONS[u.role] })) });
  }),
);

const createUser = z.object({
  email: z.string().min(5).max(120),
  name: z.string().min(2).max(80),
  role: z.enum(['minister', 'analyst', 'director', 'auditor']),
  password: z.string().min(8).max(120),
});

usersRouter.post(
  '/',
  requirePermission('users.admin'),
  validate({ body: createUser }),
  asyncHandler((req, res) => {
    const b = v<z.infer<typeof createUser>>(req, 'body');
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(b.email.toLowerCase());
    if (exists) throw ApiError.validation(`User '${b.email}' already exists`);
    const { hash, salt } = hashPassword(b.password);
    const info = db
      .prepare('INSERT INTO users (email, name, role, password_hash, salt, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(b.email.toLowerCase(), b.name, b.role, hash, salt, new Date().toISOString());
    audit(req, 'user.create', `user:${b.email.toLowerCase()}`, { role: b.role });
    res.status(201).json({ user: { id: Number(info.lastInsertRowid), email: b.email.toLowerCase(), name: b.name, role: b.role, active: true } });
  }),
);

const patchUser = z.object({
  name: z.string().min(2).max(80).optional(),
  role: z.enum(['minister', 'analyst', 'director', 'auditor']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(120).optional(),
});

usersRouter.patch(
  '/:id',
  requirePermission('users.admin'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: patchUser }),
  asyncHandler((req, res) => {
    const id = v<{ id: number }>(req, 'params').id;
    const b = v<z.infer<typeof patchUser>>(req, 'body');
    const row = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as { id: number; email: string } | undefined;
    if (!row) throw ApiError.notFound(`User ${id} not found`);
    if (b.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name, id);
    if (b.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, id);
    if (b.active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
    if (b.password) {
      const { hash, salt } = hashPassword(b.password);
      db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, id);
    }
    audit(req, 'user.update', `user:${row.email}`, { fields: Object.keys(b) });
    res.json({ user: db.prepare('SELECT id, email, name, role, active FROM users WHERE id = ?').get(id) });
  }),
);

usersRouter.delete(
  '/:id',
  requirePermission('users.admin'),
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler((req, res) => {
    const id = v<{ id: number }>(req, 'params').id;
    const row = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(id) as
      | { id: number; email: string; role: Role }
      | undefined;
    if (!row) throw ApiError.notFound(`User ${id} not found`);
    if (row.id === req.user!.id) throw ApiError.validation('You cannot deactivate your own account');
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    audit(req, 'user.deactivate', `user:${row.email}`, { role: row.role });
    res.json({ ok: true, deactivated: { id, email: row.email } });
  }),
);

/* ----------------------------------------------------------- dashboard */

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  requirePermission('dashboard.view'),
  asyncHandler((req, res) => {
    const datasets = listDatasets();
    const baseline = measureBaseline();
    const cards = listPolicyCards();
    const portfolio = cards.length ? runOptimiser({ cards }) : null;
    const severity = db.prepare('SELECT severity, COUNT(*) AS n FROM anomalies GROUP BY severity').all() as
      | { severity: string; n: number }[];
    const recentAudit = db.prepare('SELECT id, ts, actor, action, entity FROM audit_log ORDER BY id DESC LIMIT 8').all();
    res.json({
      user: { email: req.user!.email, role: req.user!.role, permissions: ROLE_PERMISSIONS[req.user!.role] },
      kpis: {
        datasets: datasets.length,
        rows: datasets.reduce((a, d) => a + d.row_count, 0),
        anomalies: anomalyCount(),
        policyCards: cards.length,
        idleCapitalCr: totalIdleCapitalCr(),
        utilisationPct: baseline.utilisationPct,
        distressedBridges: baseline.distressedBridges,
        meanAmbulanceResponseMin: baseline.responseMin,
        functionalTapPct: baseline.functionalTapPct,
        grievanceDaysToClose: baseline.grievanceDaysToClose,
      },
      datasets: datasets.map(datasetSummary),
      anomaliesBySeverity: severity,
      topPolicyCards: cards.slice(0, 5).map((c) => ({ code: c.code, title: c.title, impactScore: c.impactScore, costCr: c.costCr, sector: c.sector })),
      portfolio: portfolio
        ? { budgetCr: portfolio.budgetCr, totalCostCr: portfolio.totalCostCr, totalImpact: portfolio.totalImpact, items: portfolio.chosen.length, utilisationPct: portfolio.utilisationPct }
        : null,
      auditChain: (() => {
        const vr = verifyChain();
        return { valid: vr.valid, entries: vr.entries, headHash: vr.headHash };
      })(),
      recentAudit,
      roles: ROLES,
    });
  }),
);
