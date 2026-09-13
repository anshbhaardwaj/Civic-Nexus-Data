/**
 * CivicData Nexus API server (SPEC §1-§7).
 * Boot is idempotent: schema, demo users, all 8 seed datasets ingested through
 * the real 10-step pipeline, AI-1 anomalies and AI-6 policy cards seeded when
 * empty — so no endpoint ever answers with an empty payload.
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { anomalyCount, runAnomalyScan } from './ai/anomaly';
import { policyCardCount, refreshPolicyCards } from './ai/mcda';
import { DB_PATH, ROOT, db, getMeta, initSchema, setMeta } from './db';
import { seedUsers } from './lib/auth';
import { errorHandler, notFoundHandler } from './lib/http';
import { ingestSeedDatasets } from './lib/ingest';
import { fontsAvailable } from './lib/pdf';
import { aiRouter } from './routes/ai';
import { authRouter } from './routes/auth';
import { anomaliesRouter, datasetsRouter, lineageRouter } from './routes/datasets';
import { auditRouter, briefRouter, dashboardRouter, liveRouter, simulateRouter, usersRouter } from './routes/ops';

const BOOT_VERSION = '1';

export interface BootReport {
  users: number;
  datasets: number;
  rows: number;
  rejects: number;
  anomalies: number;
  policyCards: number;
  ingestedThisBoot: number;
  ms: number;
  reused: boolean;
}

export function boot(): BootReport {
  const t0 = Date.now();
  initSchema();
  const users = seedUsers();
  const reused = getMeta('boot_version') === BOOT_VERSION;
  const ingests = ingestSeedDatasets(false);
  if (anomalyCount() === 0) runAnomalyScan({ replace: true });
  if (policyCardCount() === 0) refreshPolicyCards();
  setMeta('boot_version', BOOT_VERSION);
  setMeta('last_boot_at', new Date().toISOString());
  const totals = db
    .prepare('SELECT COUNT(*) AS datasets, COALESCE(SUM(row_count),0) AS rows, COALESCE(SUM(reject_count),0) AS rejects FROM datasets')
    .get() as { datasets: number; rows: number; rejects: number };
  return {
    users,
    datasets: totals.datasets,
    rows: totals.rows,
    rejects: totals.rejects,
    ingestedThisBoot: ingests.length,
    anomalies: anomalyCount(),
    policyCards: policyCardCount(),
    ms: Date.now() - t0,
    reused,
  };
}

export function createApp(bootReport: BootReport) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use(express.text({ limit: '25mb', type: ['text/csv', 'text/plain'] }));

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  /** Health is intentionally unauthenticated and always answers JSON 200. */
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'civicdata-nexus-api',
      version: process.env.npm_package_version ?? '1.0.0',
      time: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      database: { path: DB_PATH, exists: fs.existsSync(DB_PATH) },
      boot: bootReport,
      pdfFonts: fontsAvailable(),
      offline: true,
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/datasets', datasetsRouter);
  app.use('/api/lineage', lineageRouter);
  app.use('/api/anomalies', anomaliesRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/simulate', simulateRouter);
  app.use('/api/live', liveRouter);
  app.use('/api/brief', briefRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/dashboard', dashboardRouter);

  /* Production: serve the built client if the frontend agent has produced one. */
  const clientDist = path.resolve(ROOT, 'client/dist');
  const distIndex = path.join(clientDist, 'index.html');
  if (fs.existsSync(distIndex)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(distIndex));
  } else {
    app.get('/', (_req, res) => {
      res.status(200).json({
        service: 'CivicData Nexus API',
        message: 'client/dist is not built yet; the API is live.',
        health: '/api/health',
        docs: 'docs/API.md',
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const report = boot();
  const app = createApp(report);
  const port = Number(process.env.PORT ?? 5000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[civicdata-nexus] API listening on http://localhost:${port} — ` +
        `${report.datasets} datasets, ${report.rows} rows, ${report.anomalies} anomalies, ` +
        `${report.policyCards} policy cards (boot ${report.ms}ms, db ${DB_PATH})`,
    );
  });
}
