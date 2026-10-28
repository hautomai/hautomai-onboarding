import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { StepEngine, Scheduler, type Logger, type ProviderFactory, type Repository } from '@hautomai/core';
import { createProviderFactory } from '@hautomai/adapters';
import { createLogger } from './logger.js';
import { baseUrl } from './config.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';

const here = dirname(fileURLToPath(import.meta.url));

export type ServerDeps = {
  repository: Repository;
  env: Record<string, string | undefined>;
  logger?: Logger;
};

export type System = {
  repository: Repository;
  factory: ProviderFactory;
  engine: StepEngine;
  scheduler: Scheduler;
  logger: Logger;
  env: Record<string, string | undefined>;
  staticServed: boolean;
};

export type BuiltApp = {
  app: FastifyInstance;
  system: System;
};

export async function buildApp(deps: ServerDeps): Promise<BuiltApp> {
  const logger = deps.logger ?? createLogger('app');
  const factory = createProviderFactory(deps.env);
  const url = baseUrl();
  const engine = new StepEngine(
    { repo: deps.repository, factory },
    { logger, baseUrl: url },
  );
  const scheduler = new Scheduler(
    { repo: deps.repository, factory },
    { logger, baseUrl: url },
  );

  const candidates = [
    deps.env.WEB_DIST ? resolve(deps.env.WEB_DIST) : undefined,
    resolve(here, '../../web/dist'),
    resolve(here, '../../../web/dist'),
    resolve(process.cwd(), 'packages/web/dist'),
  ].filter(Boolean) as string[];
  const webDist = candidates.find((c) => existsSync(join(c, 'index.html')));

  const system: System = {
    repository: deps.repository,
    factory,
    engine,
    scheduler,
    logger,
    env: deps.env,
    staticServed: Boolean(webDist),
  };

  const app = Fastify({
    logger: { level: 'warn' },
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(fastifyRawBody);
  await app.register(fastifyMultipart);

  await registerPublicRoutes(app, system);
  await registerAdminRoutes(app, system);

  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method !== 'GET' || request.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, system };
}