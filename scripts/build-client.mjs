/**
 * Builds the Vite client only if the frontend exists. The backend build must
 * never fail just because client code has not been authored yet.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'client', 'index.html');

if (!existsSync(entry)) {
  console.log('[build-client] client/index.html not found — skipping client build (API-only build).');
  process.exit(0);
}

const r = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
