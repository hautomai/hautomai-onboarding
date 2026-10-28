import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
// Load .env from the workspace root, the package root, or the current cwd —
// whichever exists first (monorepo dev + deployed container).
for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(here, '../../../.env'),
  resolve(here, '../.env'),
]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  PORT: num(process.env.PORT, 3000),
  HOST: process.env.HOST || '0.0.0.0',
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hautomai',
  ENC_KEY: process.env.ENC_KEY || '',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
  WEBHOOK_AUTH: process.env.WEBHOOK_AUTH || '',
  DOCS_DIR: resolve(process.env.DOCS_DIR || '.uploads'),
  WEB_DIST: resolve(process.env.WEB_DIST || resolve(here, '../../web/dist')),
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  RUN_SCHEDULER: process.env.RUN_SCHEDULER !== 'false',
  SCHEDULER_INTERVAL_MS: num(process.env.SCHEDULER_INTERVAL_MS, 60_000),
};

export const isEncryptionConfigured = env.ENC_KEY.length >= 16;
export const baseUrl = () => (env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/$/, '') : '');