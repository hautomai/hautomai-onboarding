import { createPool, runMigrations } from './db/migrate.js';
import { PgRepository } from './db/repository.js';
import { buildApp } from './app.js';
import { env, isEncryptionConfigured } from './config.js';
import { createLogger } from './logger.js';

// Dev convenience: without ENC_KEY the configs stay encrypted under a fixed
// dev key so the app is usable out of the box. Set a real ENC_KEY in prod.
const DEV_KEY = 'dev-only-enc-key-please-change-0123456789';
const encKey = env.ENC_KEY.length >= 16 ? env.ENC_KEY : DEV_KEY;

async function main(): Promise<void> {
  const logger = createLogger('boot');

  if (!isEncryptionConfigured) {
    logger.warn('ENC_KEY is not set - using the built-in DEV key. Set ENC_KEY in production.');
  }

  logger.info('running database migrations', { database: env.DATABASE_URL.replace(/\/\/.*@/, '//***@') });
  await runMigrations(env.DATABASE_URL, { info: (s) => logger.info(s) });

  const pool = createPool(env.DATABASE_URL);
  const repository = new PgRepository(pool, encKey);
  const built = await buildApp({ repository, env: process.env as Record<string, string | undefined>, logger });
  const { app, system } = built;

  let timer: NodeJS.Timeout | undefined;
  if (env.RUN_SCHEDULER) {
    timer = setInterval(() => {
      system.scheduler.runTick().catch((err) => {
        system.logger.error('scheduler.tick_failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }, env.SCHEDULER_INTERVAL_MS);
    timer.unref();
    logger.info('scheduler enabled', { intervalMs: env.SCHEDULER_INTERVAL_MS });
  } else {
    logger.info('scheduler disabled (RUN_SCHEDULER=false)');
  }

  const shutdown = async () => {
    if (timer) clearInterval(timer);
    logger.info('shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`hautomai admin-ready at http://${env.HOST}:${env.PORT}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});