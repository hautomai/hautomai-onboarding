import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryRepository,
  Scheduler,
  parseClientConfig,
  type Customer,
} from '@hautomai/core';
import { createProviderFactory, resetMemorySink, memorySink } from '@hautomai/adapters';

const docsDir = mkdtempSync(join(tmpdir(), 'hauto-sched-'));

function scheduledConfig() {
  return parseClientConfig({
    name: 'Acme',
    alerts: [{ provider: 'memory', events: ['failed'] }],
    steps: {
      send_checkin: {
        enabled: true,
        trigger: 'scheduler',
        scheduler: { enabled: true, delayMinutes: 1440, businessHoursOnly: false },
      },
    },
  });
}

async function setup(signupAt: Date, now: Date) {
  resetMemorySink();
  const repo = new MemoryRepository();
  const client = await repo.createClient({ name: 'Acme', slug: 'acme' });
  await repo.updateClientConfig(client.id, scheduledConfig());
  const factory = createProviderFactory({ DOCS_DIR: docsDir });
  const scheduler = new Scheduler({ repo, factory }, { clock: () => now });

  const customer: Customer = {
    id: 'c1',
    clientSlug: client.slug,
    email: 'ada@example.com',
    payload: { customerName: 'Ada Lovelace', email: 'ada@example.com' },
    status: 'registered',
    completedSteps: {},
    failed: false,
    signupAt: signupAt.toISOString(),
    createdAt: signupAt.toISOString(),
    updatedAt: signupAt.toISOString(),
  };
  repo.seedCustomer(customer);
  return { repo, client, scheduler, customer };
}

describe('Scheduler.runTick', () => {
  beforeEach(() => resetMemorySink());

  it('does not fire before the delay elapses', async () => {
    const signup = new Date('2026-09-01T09:00:00Z');
    const now = new Date('2026-09-01T23:00:00Z'); // 14h < 24h
    const { repo, client, scheduler } = await setup(signup, now);
    const { fired } = await scheduler.runTick(now);
    expect(fired).toBe(0);
    const customer = await repo.getCustomer(client.slug, 'ada@example.com');
    expect(customer?.completedSteps.send_checkin).toBeUndefined();
    expect(memorySink.emails.length).toBe(0);
  });

  it('fires the scheduled step once it is due', async () => {
    const signup = new Date('2026-09-01T09:00:00Z');
    const now = new Date('2026-09-02T12:00:00Z'); // 27h > 24h
    const { repo, client, scheduler, customer } = await setup(signup, now);
    const { fired } = await scheduler.runTick(now);
    expect(fired).toBe(1);
    const updated = await repo.getCustomer(client.slug, 'ada@example.com');
    expect(updated?.completedSteps.send_checkin).toBeTruthy();
    expect(memorySink.emails.some((m) => m.subject.includes('How is it going'))).toBe(true);
    void customer;
  });

  it('never re-fires a completed step', async () => {
    const signup = new Date('2026-09-01T09:00:00Z');
    const now = new Date('2026-09-03T12:00:00Z');
    const { repo, client, scheduler } = await setup(signup, now);

    await scheduler.runTick(now);
    expect(await repo.getCustomer(client.slug, 'ada@example.com')).toBeTruthy();
    const emailsAfterFirst = memorySink.emails.length;
    const { fired } = await scheduler.runTick(new Date('2026-09-04T12:00:00Z'));
    expect(fired).toBe(0);
    expect(memorySink.emails.length).toBe(emailsAfterFirst);
  });

  it('honours business-hours-only signups (weekend roll to Monday)', async () => {
    resetMemorySink();
    const repo = new MemoryRepository();
    const client = await repo.createClient({ name: 'Acme', slug: 'acme' });
    await repo.updateClientConfig(
      client.id,
      parseClientConfig({
        name: 'Acme',
        steps: {
          send_documents: {
            enabled: true,
            trigger: 'scheduler',
            scheduler: { enabled: true, delayMinutes: 120, businessHoursOnly: true },
          },
        },
        storage: { provider: 'memory' },
      }),
    );
    const factory = createProviderFactory({ DOCS_DIR: docsDir });
    const now = new Date('2026-09-13T12:00:00Z'); // Sunday
    const scheduler = new Scheduler({ repo, factory }, { clock: () => now });

    const signup = new Date('2026-09-12T10:00:00Z'); // Saturday
    const customer: Customer = {
      id: 'c2',
      clientSlug: client.slug,
      email: 'grace@example.com',
      payload: { customerName: 'Grace Hopper', email: 'grace@example.com' },
      status: 'registered',
      completedSteps: {},
      failed: false,
      signupAt: signup.toISOString(),
      createdAt: signup.toISOString(),
      updatedAt: signup.toISOString(),
    };
    repo.seedCustomer(customer);
    // Due computed = Monday 12:00 UTC; Sunday 12:00 is not yet due
    expect((await scheduler.runTick(now)).fired).toBe(0);
    const monday = new Date('2026-09-14T13:00:00Z');
    const res = await scheduler.runTick(monday);
    expect(res.fired).toBe(1);
    const updated = await repo.getCustomer(client.slug, 'grace@example.com');
    expect(updated?.completedSteps.send_documents).toBeTruthy();
  });
});