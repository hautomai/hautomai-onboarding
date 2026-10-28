import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryRepository,
  StepEngine,
  parseClientConfig,
  type EventEnvelope,
} from '@hautomai/core';
import { createProviderFactory, resetMemorySink, memoryControllables, memorySink } from '@hautomai/adapters';

const docsDir = mkdtempSync(join(tmpdir(), 'hauto-test-'));

function makeClientConfig(overrides: Record<string, unknown> = {}) {
  return parseClientConfig({
    name: 'Acme',
    alerts: [
      { provider: 'memory', events: ['signup', 'failed'] },
    ],
    ...overrides,
  });
}

async function engineFor(overrides: Record<string, unknown> = {}, clock?: () => Date) {
  const repo = new MemoryRepository();
  resetMemorySink();
  const client = await repo.createClient({ name: 'Acme', slug: 'acme' });
  await repo.updateClientConfig(client.id, makeClientConfig(overrides));
  const factory = createProviderFactory({ DOCS_DIR: docsDir });
  const engine = new StepEngine({ repo, factory }, { clock: clock ?? (() => new Date()) });
  return { repo, client, engine };
}

const baseEvent = (customer: Record<string, string>, steps: string[]): EventEnvelope => ({
  clientSlug: 'acme',
  provider: 'webhook',
  steps: steps as EventEnvelope['steps'],
  customer: {
    customerName: customer.customerName,
    email: customer.email,
    package: customer.package ?? '',
  },
  receivedAt: new Date().toISOString(),
});

describe('StepEngine happy path', () => {
  beforeEach(() => resetMemorySink());

  it('runs the signup steps and updates the customer', async () => {
    const { repo, client, engine } = await engineFor();
    const ev = baseEvent(
      { customerName: 'Ada Lovelace', email: 'ada@example.com', package: 'Basic' },
      ['create_crm_contact', 'send_team_alert', 'send_welcome_email'],
    );
    const { customer, results } = await engine.handleEvent(client, ev);

    expect(results.map((r) => [r.step, r.status])).toEqual([
      ['create_crm_contact', 'success'],
      ['send_team_alert', 'success'],
      ['send_welcome_email', 'success'],
    ]);
    const stored = await repo.getCustomer(client.slug, 'ada@example.com');
    expect(stored?.status).toBe('welcome_sent');
    expect(stored?.failed).toBe(false);

    // CRM sink got the contact
    expect(memorySink.crmContacts.length).toBe(1);
    expect(memorySink.crmContacts[0]?.input.customer.email).toBe('ada@example.com');

    // Team alert was delivered to a channel
    expect(memorySink.alerts.some((a) => a.message.title.includes('New customer'))).toBe(true);

    // Welcome email was composed for the right recipient
    const welcome = memorySink.emails.find((m) => m.subject.includes('Welcome to Acme'));
    expect(welcome).toBeTruthy();
    expect(welcome?.to).toBe('ada@example.com');
    expect(memorySink.emails.length).toBe(1);
    void customer;
  });

  it('upserts twice without duplicating completed steps', async () => {
    const { repo, client, engine } = await engineFor();
    const ev = baseEvent({ customerName: 'Ada Lovelace', email: 'ada@example.com' }, ['send_welcome_email']);
    await engine.handleEvent(client, ev);
    const before = (await repo.getCustomer(client.slug, 'ada@example.com'))!;
    expect(before.completedSteps.send_welcome_email).toBeTruthy();

    const { results } = await engine.handleEvent(client, ev);
    expect(results[0]?.status).toBe('skipped'); // already completed
    const after = (await repo.getCustomer(client.slug, 'ada@example.com'))!;
    expect(after.id).toBe(before.id);
    expect(Object.keys(after.completedSteps).length).toBe(1);
  });

  it('fails (not throws) when the crm provider rejects', async () => {
    const { repo, client, engine } = await engineFor({}, () => new Date('2026-09-14T09:00:00Z'));
    memoryControllables.failNext('crm', 4); // more failures than attempts
    const ev = baseEvent(
      { customerName: 'Grace Hopper', email: 'grace@example.com' },
      ['create_crm_contact'],
    );
    const { customer, results } = await engine.handleEvent(client, ev);
    expect(results[0]?.status).toBe('failed');
    expect(customer.failed).toBe(true);
    // failure alert delivered to the memory channel
    expect(memorySink.alerts.some((a) => a.message.title.includes('failed'))).toBe(true);
    const run = await repo.getLastStepRun(client.slug, 'grace@example.com', 'create_crm_contact');
    expect(run?.status).toBe('failed');
    expect(run?.attempts).toBe(3);
    expect(run?.nextAttemptAt).toBeNull();
  });
});

describe('StepEngine retries', () => {
  beforeEach(() => resetMemorySink());

  it('recovers on the second attempt', async () => {
    const clock = new Date('2026-09-14T09:00:00Z');
    const { repo, client, engine } = await engineFor({}, () => clock);
    memoryControllables.failNext('crm', 1); // only the first call throws
    const ev = baseEvent(
      { customerName: 'Grace Hopper', email: 'grace@example.com' },
      ['create_crm_contact'],
    );
    const { results } = await engine.handleEvent(client, ev);
    expect(results[0]?.status).toBe('success');
    expect(results[0]?.attempts).toBe(2);
    const run = await repo.getLastStepRun(client.slug, 'grace@example.com', 'create_crm_contact');
    expect(run?.status).toBe('success');
    expect(run?.attempts).toBe(2);
  });

  it('exhausts max attempts then marks the customer failed', async () => {
    const clock = new Date('2026-09-14T09:00:00Z');
    const { repo, client, engine } = await engineFor({}, () => clock);
    memoryControllables.failNext('crm', 3); // exhaust all 3 attempts
    const ev = baseEvent(
      { customerName: 'Grace Hopper', email: 'grace@example.com' },
      ['create_crm_contact'],
    );
    const { customer, results } = await engine.handleEvent(client, ev);
    expect(results[0]?.status).toBe('failed');
    expect(customer.failed).toBe(true);
    const run = await repo.getLastStepRun(client.slug, 'grace@example.com', 'create_crm_contact');
    expect(run?.status).toBe('failed');
    expect(run?.nextAttemptAt).toBeNull();
  });
});