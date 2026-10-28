import type { FastifyInstance } from 'fastify';
import type { System } from '../app.js';
import {
  DEFAULT_EVENT_MAP,
  type EventEnvelope,
  type StepId,
} from '@hautomai/core';
import {
  extractCustomerFromEvent,
  parseWebhookPayload,
  resolveSteps,
  verifyStripeSignature,
} from '@hautomai/adapters';

type SlugParams = { slug: string };

function bodyText(body: unknown, rawBody: unknown): string {
  if (rawBody && (rawBody as Buffer).byteLength) return Buffer.from(rawBody as Buffer).toString('utf8');
  if (typeof body === 'string') return body;
  return typeof body === 'object' && body !== null ? JSON.stringify(body) : '';
}

export async function registerPublicRoutes(app: FastifyInstance, system: System) {
  const { repository, engine, env } = system;

  // ---- generic inbound webhook ----
  app.post<{ Params: SlugParams }>('/webhook/:slug', async (request, reply) => {
    const webhookAuth = env.WEBHOOK_AUTH?.trim();
    if (webhookAuth && request.headers['x-webhook-auth'] !== webhookAuth) {
      return reply.code(401).send({ error: 'invalid webhook token' });
    }
    const client = await repository.getClientBySlug(request.params.slug);
    if (!client) return reply.code(404).send({ error: 'client not found' });

    const text = bodyText(request.body, (request as { rawBody?: unknown }).rawBody);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return reply.code(400).send({ error: 'invalid JSON body' });
    }
    const payload = parseWebhookPayload(json);
    if (!payload) {
      return reply
        .code(422)
        .send({ error: 'invalid payload', required: { customerName: 'string', email: 'string' } });
    }

    const steps = resolveSteps(json as { steps?: unknown }, client);
    const envelope: EventEnvelope = {
      clientSlug: client.slug,
      provider: 'webhook',
      steps,
      customer: payload,
      receivedAt: new Date().toISOString(),
    };
    const { customer, results } = await engine.handleEvent(client, envelope);
    return reply.code(200).send({ ok: true, customerId: customer.id, results });
  });

  // ---- Stripe webhook ----
  app.post<{ Params: SlugParams }>('/stripe/:slug', async (request, reply) => {
    const client = await repository.getClientBySlug(request.params.slug);
    if (!client) return reply.code(404).send({ error: 'client not found' });

    const secret = client.config.trigger.stripe?.webhookSecret || env.STRIPE_WEBHOOK_SECRET;
    const signature = request.headers['stripe-signature'] as string | undefined;
    const rawBody = (request as { rawBody?: unknown }).rawBody;
    const text = bodyText(request.body, rawBody);
    if (!verifyStripeSignature(text, signature, secret)) {
      return reply.code(400).send({ error: 'invalid stripe signature' });
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return reply.code(400).send({ error: 'invalid JSON body' });
    }

    const eventMap = { ...DEFAULT_EVENT_MAP, ...(client.config.trigger.stripe?.eventMap ?? {}) };
    const extracted = extractCustomerFromEvent(event, eventMap, client.config.trigger.signupSteps);
    if (!extracted) {
      return reply.code(422).send({ error: 'no customer email derivable from event' });
    }

    const envelope: EventEnvelope = {
      clientSlug: client.slug,
      provider: 'stripe',
      steps: extracted.steps,
      customer: extracted.customer,
      receivedAt: new Date().toISOString(),
    };
    const { customer, results } = await engine.handleEvent(client, envelope);
    return reply.code(200).send({ ok: true, customerId: customer.id, results });
  });
}

export type { StepId };