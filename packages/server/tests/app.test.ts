import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRepository, type Client } from '@hautomai/core';
import { resetMemorySink, memorySink } from '@hautomai/adapters';
import { buildApp, type BuiltApp } from '../src/app.js';

const docsDir = mkdtempSync(join(tmpdir(), 'hauto-server-'));

async function createApp(env: Record<string, string> = {}): Promise<BuiltApp> {
  const repository = new MemoryRepository();
  const built = await buildApp({ repository, env: { DOCS_DIR: docsDir, ...env } });
  return built;
}

async function createTestClient(app: BuiltApp, name = 'Acme', slug = 'acme'): Promise<Client> {
  const res = await app.app.inject({
    method: 'POST',
    url: '/admin/api/clients',
    payload: { name, slug },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Client;
}

beforeEach(() => resetMemorySink());

describe('admin API', () => {
  it('serves the built admin UI from / when web/dist exists', async () => {
    const { app, system } = await createApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    if (!system.staticServed) {
      expect(true).toBe(true); // statics not built in this checkout; nothing to assert
      return;
    }
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const spa = await app.inject({ method: 'GET', url: '/some/client-route' });
    expect(spa.statusCode).toBe(200);
    const api404 = await app.inject({ method: 'GET', url: '/api/not-a-route' });
    expect(api404.statusCode).toBe(404);
    await app.close();
  });

  it('lists no clients initially', async () => {
    const built = await createApp();
    const res = await built.app.inject({ method: 'GET', url: '/admin/api/clients' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('creates, reads and deletes a client', async () => {
    const built = await createApp();
    const created = await createTestClient(built);
    expect(created.slug).toBe('acme');
    expect(created.config.name).toBe('Acme');

    const read = await built.app.inject({ method: 'GET', url: '/admin/api/clients/acme' });
    expect(read.statusCode).toBe(200);
    expect(read.json().config.crm.provider).toBe('memory');

    const del = await built.app.inject({ method: 'DELETE', url: '/admin/api/clients/acme' });
    expect(del.statusCode).toBe(204);
    const read2 = await built.app.inject({ method: 'GET', url: '/admin/api/clients/acme' });
    expect(read2.statusCode).toBe(404);
  });

  it('protects the admin API when ADMIN_TOKEN is set', async () => {
    const built = await createApp({ ADMIN_TOKEN: 'sekret' });
    const denied = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients',
      headers: { authorization: 'Bearer sekret' },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('onboarding flow via the admin simulate endpoint', () => {
  it('runs the signup steps end to end', async () => {
    const built = await createApp();
    await createTestClient(built);

    const res = await built.app.inject({
      method: 'POST',
      url: '/admin/api/clients/acme/simulate',
      payload: {
        customer: { customerName: 'Ada Lovelace', email: 'ada@example.com', package: 'Basic' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toBe(undefined);

    const results: Array<{ step: string; status: string }> = body.results;
    expect(results.map((r) => r.step).sort()).toEqual([
      'create_crm_contact',
      'send_team_alert',
      'send_welcome_email',
    ]);
    const byStep = Object.fromEntries(results.map((r) => [r.step, r.status]));
    expect(byStep.create_crm_contact).toBe('success');
    expect(byStep.send_welcome_email).toBe('success');
    expect(byStep.send_team_alert).toBe('skipped'); // no alert channel configured by default

    const customers = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients/acme/customers',
    });
    const list = customers.json();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('welcome_sent');
    expect(list[0].payload.email).toBe('ada@example.com');

    expect(memorySink.emails.some((m) => m.to === 'ada@example.com')).toBe(true);
    expect(memorySink.crmContacts.length).toBe(1);

    // steps endpoint exposes the run trail
    const stepsRes = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients/acme/customers/ada%40example.com/steps',
    });
    expect(stepsRes.statusCode).toBe(200);
    const stepBody = stepsRes.json();
    expect(stepBody.runs.length).toBeGreaterThanOrEqual(3);
    expect(stepBody.runs.every((r: { status: string }) => r.status === 'success')).toBe(true);
  });

  it('rejects a bad simulate payload', async () => {
    const built = await createApp();
    await createTestClient(built);
    const res = await built.app.inject({
      method: 'POST',
      url: '/admin/api/clients/acme/simulate',
      payload: { customer: { customerName: 'No email' } },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('public webhook', () => {
  it('accepts the spec payload and processes the signup', async () => {
    const built = await createApp();
    await createTestClient(built);

    const res = await built.app.inject({
      method: 'POST',
      url: '/webhook/acme',
      payload: {
        customerName: 'Grace Hopper',
        email: 'grace@example.com',
        phone: '+33600000001',
        package: 'Enterprise',
        source: 'referral',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const customers = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients/acme/customers?q=grace',
    });
    expect(customers.json()).toHaveLength(1);
    expect(customers.json()[0].payload.package).toBe('Enterprise');
    expect(memorySink.emails.some((m) => m.to === 'grace@example.com')).toBe(true);
  });

  it('supports step overrides in the body', async () => {
    const built = await createApp();
    await createTestClient(built);
    const res = await built.app.inject({
      method: 'POST',
      url: '/webhook/acme',
      payload: {
        customer: { customerName: 'Marie Curie', email: 'marie@example.com' },
        steps: ['send_welcome_email'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(1);
  });

  it('returns 404 for unknown clients and 422 for bad payloads', async () => {
    const built = await createApp();
    await createTestClient(built);
    expect(
      (await built.app.inject({ method: 'POST', url: '/webhook/nope', payload: {} })).statusCode,
    ).toBe(404);
    expect(
      (await built.app.inject({ method: 'POST', url: '/webhook/acme', payload: { email: 'x' } }))
        .statusCode,
    ).toBe(422);
  });

  it('enforces the global webhook token when configured', async () => {
    const built = await createApp({ WEBHOOK_AUTH: 'hook-token' });
    await createTestClient(built);
    const denied = await built.app.inject({
      method: 'POST',
      url: '/webhook/acme',
      payload: { customerName: 'A', email: 'a@example.com' },
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await built.app.inject({
      method: 'POST',
      url: '/webhook/acme',
      headers: { 'x-webhook-auth': 'hook-token' },
      payload: { customerName: 'B', email: 'b@example.com' },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('stripe webhook', () => {
  it('handles a checkout.session.completed event', async () => {
    const built = await createApp();
    await createTestClient(built);
    const res = await built.app.inject({
      method: 'POST',
      url: '/stripe/acme',
      payload: {
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_details: { name: 'Nina', email: 'nina@example.com' },
            metadata: { package: 'Studio' },
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const customers = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients/acme/customers',
    });
    expect(customers.json()[0].payload.package).toBe('Studio');
  });

  it('validates the signature when a secret is configured', async () => {
    const built = await createApp();
    const client = await createTestClient(built);
    // set a stripe webhook secret
    await built.app.inject({
      method: 'PUT',
      url: '/admin/api/clients/acme/config',
      payload: {
        config: {
          ...client.config,
          trigger: {
            ...client.config.trigger,
            stripe: { ...(client.config.trigger.stripe ?? { eventMap: {}, mapping: {} }), webhookSecret: 'whsec_x' },
          },
        },
      },
    });
    const noSig = await built.app.inject({
      method: 'POST',
      url: '/stripe/acme',
      payload: { id: 'evt_2', type: 'checkout.session.completed', data: { object: { email: 'a@b.com' } } },
    });
    expect(noSig.statusCode).toBe(400);
  });
});

describe('documents', () => {
  it('uploads, lists and serves a document file', async () => {
    const built = await createApp();
    await createTestClient(built);

    const boundary = '----hautomaiTestBoundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="step"',
      '',
      'send_documents',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="contrat.pdf"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.4 sample content',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploaded = await built.app.inject({
      method: 'POST',
      url: '/admin/api/clients/acme/documents',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(body),
    });
    expect(uploaded.statusCode).toBe(201);
    const doc = uploaded.json().document;
    expect(doc.step).toBe('send_documents');
    expect(doc.size).toBe(Buffer.byteLength('%PDF-1.4 sample content'));

    const documents = await built.app.inject({
      method: 'GET',
      url: '/admin/api/clients/acme/documents',
    });
    expect(documents.json()).toHaveLength(1);

    const file = await built.app.inject({
      method: 'GET',
      url: `/files/${doc.storageKey}`,
    });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.toString()).toBe('%PDF-1.4 sample content');
  });
});

describe('scheduler endpoint', () => {
  it('runs a tick through the admin API', async () => {
    const built = await createApp();
    await createTestClient(built);
    const res = await built.app.inject({
      method: 'POST',
      url: '/admin/api/run-tick',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(typeof res.json().fired).toBe('number');
  });
});