import type { FastifyInstance } from 'fastify';
import type { System } from '../app.js';
import {
  CustomerPayloadSchema,
  parseClientConfig,
  safeEqual,
  slugify,
  type StepId,
} from '@hautomai/core';

type SlugParams = { slug: string };
type CustomerParams = { slug: string; email: string };
type CustomerIdParams = { slug: string; id: string };

export function adminTokenOk(request: { headers: Record<string, unknown> }, adminToken: string): boolean {
  if (!adminToken) return true; // auth placeholder: open when ADMIN_TOKEN unset
  const header = request.headers.authorization || request.headers['x-admin-token'] || '';
  const provided = String(header).replace(/^Bearer\s+/i, '').trim();
  return provided.length > 0 && safeEqual(provided, adminToken);
}

function deny(reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  return reply.code(401).send({ error: 'unauthorized' });
}

export async function registerAdminRoutes(app: FastifyInstance, system: System) {
  const { repository, engine, scheduler, factory, env } = system;
  const adminToken = env.ADMIN_TOKEN || '';

  const guard = (request: { headers: Record<string, unknown> }, reply: Parameters<typeof deny>[0]) => {
    if (!adminTokenOk(request, adminToken)) {
      deny(reply);
      return false;
    }
    return true;
  };

  // ---- clients ----
  app.get('/admin/api/clients', async (request, reply) => {
    if (!guard(request, reply)) return;
    return repository.listClients();
  });

  app.post<{ Body: { name?: string; slug?: string } }>('/admin/api/clients', async (request, reply) => {
    if (!guard(request, reply)) return;
    const name = String(request.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const slug = slugify(request.body?.slug || name);
    try {
      const client = await repository.createClient({ name, slug });
      return reply.code(201).send(client);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: SlugParams }>('/admin/api/clients/:slug', async (request, reply) => {
    if (!guard(request, reply)) return;
    const client = await repository.getClientBySlug(request.params.slug);
    if (!client) return reply.code(404).send({ error: 'client not found' });
    return client;
  });

  app.put<{ Params: SlugParams; Body: { config?: unknown } }>(
    '/admin/api/clients/:slug/config',
    async (request, reply) => {
      if (!guard(request, reply)) return;
      const client = await repository.getClientBySlug(request.params.slug);
      if (!client) return reply.code(404).send({ error: 'client not found' });
      try {
        const config = parseClientConfig(request.body?.config ?? {});
        const updated = await repository.updateClientConfig(client.id, config);
        return updated;
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: SlugParams }>('/admin/api/clients/:slug', async (request, reply) => {
    if (!guard(request, reply)) return;
    const client = await repository.getClientBySlug(request.params.slug);
    if (!client) return reply.code(404).send({ error: 'client not found' });
    await repository.deleteClient(client.id);
    return reply.code(204).send();
  });

  // ---- customers ----
  app.get<{ Params: SlugParams; Querystring: { status?: string; q?: string; failed?: string } }>(
    '/admin/api/clients/:slug/customers',
    async (request, reply) => {
      if (!guard(request, reply)) return;
      const client = await repository.getClientBySlug(request.params.slug);
      if (!client) return reply.code(404).send({ error: 'client not found' });
      const failed = request.query.failed === undefined ? undefined : request.query.failed === 'true';
      const customers = await repository.listCustomers({
        clientSlug: client.slug,
        status: request.query.status,
        q: request.query.q,
        failed,
      });
      return customers;
    },
  );

  app.get<{ Params: CustomerParams }>(
    '/admin/api/clients/:slug/customers/:email/steps',
    async (request, reply) => {
      if (!guard(request, reply)) return;
      const client = await repository.getClientBySlug(request.params.slug);
      if (!client) return reply.code(404).send({ error: 'client not found' });
      const customer = await repository.getCustomer(client.slug, request.params.email);
      if (!customer) return reply.code(404).send({ error: 'customer not found' });
      const runs = await repository.listStepRuns({
        clientSlug: client.slug,
        customerEmail: customer.email,
      });
      const config = client.config.steps ?? {};
      const steps = Object.keys(config).length > 0
        ? config
        : { create_crm_contact: { enabled: true, trigger: 'inbound' as const } };
      return { customer, runs, steps: { ...steps } };
    },
  );

  app.post<{ Params: SlugParams; Body: { customer?: unknown; steps?: StepId[] } }>(
    '/admin/api/clients/:slug/simulate',
    async (request, reply) => {
      if (!guard(request, reply)) return;
      const client = await repository.getClientBySlug(request.params.slug);
      if (!client) return reply.code(404).send({ error: 'client not found' });
      const parsed = CustomerPayloadSchema.safeParse(request.body?.customer);
      if (!parsed.success) {
        return reply.code(422).send({ error: 'customer must include customerName and email' });
      }
      const requested: StepId[] | undefined = request.body?.steps;
      const steps: StepId[] =
        Array.isArray(requested) && requested.length > 0 ? requested : client.config.trigger.signupSteps;
      const envelope = {
        clientSlug: client.slug,
        provider: 'admin' as const,
        steps,
        customer: parsed.data,
        receivedAt: new Date().toISOString(),
      };
      const { customer, results } = await engine.handleEvent(client, envelope);
      return reply.code(200).send({ ok: true, customerId: customer.id, results });
    },
  );

  app.post<{ Params: CustomerIdParams; Body: { step?: StepId } }>(
    '/admin/api/clients/:slug/customers/:id/retry',
    async (request, reply) => {
      if (!guard(request, reply)) return;
      const client = await repository.getClientBySlug(request.params.slug);
      if (!client) return reply.code(404).send({ error: 'client not found' });
      const customer = await repository.getCustomerById(request.params.id);
      if (!customer || customer.clientSlug !== client.slug) {
        return reply.code(404).send({ error: 'customer not found' });
      }
      if (request.body?.step) {
        const outcome = await engine.runStep(client, customer, request.body.step);
        return { ok: true, result: outcome };
      }
      const results = await engine.retryCustomer(client, customer);
      return { ok: true, results };
    },
  );

  app.post<{ Body: Record<string, never> }>('/admin/api/run-tick', async (request, reply) => {
    if (!guard(request, reply)) return;
    const { fired, skipped } = await scheduler.runTick();
    return { ok: true, fired, skipped };
  });

  // ---- documents ----
  app.get<{ Params: SlugParams }>('/admin/api/clients/:slug/documents', async (request, reply) => {
    if (!guard(request, reply)) return;
    const client = await repository.getClientBySlug(request.params.slug);
    if (!client) return reply.code(404).send({ error: 'client not found' });
    return client.config.documents ?? [];
  });

  app.post<{ Params: SlugParams }>(
    '/admin/api/clients/:slug/documents',
    { config: { rawBody: false } }, // let @fastify/multipart consume the stream untouched
    async (request, reply) => {
      if (!guard(request, reply)) return;
      const client = await repository.getClientBySlug(request.params.slug);
      if (!client) return reply.code(404).send({ error: 'client not found' });

      const data = await request.file({ limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
      if (!data) return reply.code(400).send({ error: 'a file is required (multipart field "file")' });

      const fields = data.fields as Record<string, Array<{ value?: string }> | undefined>;
      const step = String(fields.step?.[0]?.value ?? 'send_documents') as StepId;
      const buffer = await data.toBuffer();
      const storage = factory.storage(client);
      const spec = await storage.save({
        name: data.filename || 'document.pdf',
        contentType: data.mimetype || 'application/pdf',
        data: buffer,
        step,
      });

      const config = {
        ...client.config,
        documents: [...(client.config.documents ?? []), spec],
      };
      const updated = await repository.updateClientConfig(client.id, config);
      return reply.code(201).send({ ok: true, document: spec, documents: updated.config.documents });
    },
  );

  // ---- public-ish file download (deep links in emails) ----
  app.get<{ Params: { key: string } }>('/files/:key', async (request, reply) => {
    const key = String(request.params.key ?? '');
    if (!key) return reply.code(404).send({ error: 'not found' });
    const clients = await repository.listClients();
    for (const client of clients) {
      const doc = (client.config.documents ?? []).find(
        (d) => d.storageKey === key || d.fileName === key,
      );
      if (!doc) continue;
      const storage = factory.storage(client);
      const file = await storage.read(doc);
      reply
        .header('content-type', file.contentType || 'application/pdf')
        .header('content-disposition', `inline; filename="${String(doc.fileName).replace(/"/g, '')}"`);
      return reply.send(file.data);
    }
    return reply.code(404).send({ error: 'not found' });
  });
}