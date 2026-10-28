import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { createPool, runMigrations } from '../src/db/migrate.js';
import { PgRepository } from '../src/db/repository.js';
import { buildApp } from '../src/app.js';

// Postgres integration: runs only when a test database is reachable, so it is
// safe on CI/dev machines without Postgres (the suite simply skips). Uses the
// app's own DATABASE_URL by default, works only on rows this suite creates
// (unique slug + cleanup), and never depends on leftover rows / enc keys.

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hautomai';
const ENC_KEY = 'test-enc-key-0123456789abcdef'; // gitleaks:allow test fixture

async function databaseReachable(): Promise<boolean> {
  const probe = new Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await databaseReachable();

describe.runIf(reachable)('Postgres repository + server boot', () => {
  it('migrates, encrypts configs and runs an onboarding flow', async () => {
    await runMigrations(TEST_DATABASE_URL);

    // Unique slug so the suite never collides with real client data.
    const slug = `pg-test-${randomUUID().slice(0, 8)}`;

    const pool = createPool(TEST_DATABASE_URL);
    const repository = new PgRepository(pool, ENC_KEY);
    const docsDir = mkdtempSync(join(tmpdir(), 'hauto-pg-'));

    const built = await buildApp({ repository, env: { DOCS_DIR: docsDir } });
    const app = built.app;

    try {
      // client lifecycle with encrypted config round-trip
      const createdRes = await app.inject({
        method: 'POST',
        url: '/admin/api/clients',
        payload: { name: 'Acme', slug },
      });
      expect(createdRes.statusCode).toBe(201);
      const read = await app.inject({ method: 'GET', url: `/admin/api/clients/${slug}` });
      expect(read.statusCode).toBe(200);
      expect(read.json().config.crm.provider).toBe('memory');

      // config update persists through the encryption/decryption round trip
      const patch = await app.inject({
        method: 'PUT',
        url: `/admin/api/clients/${slug}/config`,
        payload: { config: { ...read.json().config, email: { ...read.json().config.email, fromName: 'Hautomai' } } },
      });
      expect(patch.statusCode).toBe(200);
      const reRead = await app.inject({ method: 'GET', url: `/admin/api/clients/${slug}` });
      expect(reRead.json().config.email.fromName).toBe('Hautomai');

      // a webhook signup persists through a fresh repository instance
      const other = await app.inject({
        method: 'POST',
        url: `/webhook/${slug}`,
        payload: { customerName: 'Grace Hopper', email: 'grace@example.com', package: 'Enterprise' },
      });
      expect(other.statusCode).toBe(200);
      expect(other.json().ok).toBe(true);

      // upload a document and re-fetch the record from the database
      const boundary = '----hautomaiPgBoundary';
      const uploadBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="step"',
        '',
        'send_documents',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="contrat.pdf"',
        'Content-Type: application/pdf',
        '',
        '%PDF-1.4 postgres round trip',
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const uploaded = await app.inject({
        method: 'POST',
        url: `/admin/api/clients/${slug}/documents`,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.from(uploadBody),
      });
      expect(uploaded.statusCode).toBe(201);

      const freshRepository = new PgRepository(createPool(TEST_DATABASE_URL), ENC_KEY);
      const client = await freshRepository.getClientBySlug(slug);
      expect(client?.config.email.fromName).toBe('Hautomai');
      const customers = await freshRepository.listCustomers({ clientSlug: slug });
      expect(customers.map((c) => c.email)).toContain('grace@example.com');
      // documents are stored inside the (now normalized) client config
      expect(client?.config.documents).toHaveLength(1);
      expect(client?.config.documents[0]?.fileName).toBe('contrat.pdf');

      // scheduler tick runs against Postgres state without error
      const tick = await app.inject({ method: 'POST', url: '/admin/api/run-tick', payload: {} });
      expect(tick.statusCode).toBe(200);
      expect(typeof tick.json().fired).toBe('number');
      expect(typeof tick.json().skipped).toBe('number');
    } finally {
      // clean up this suite's rows (customers/step_runs cascade via deleteClient)
      await app.inject({ method: 'DELETE', url: `/admin/api/clients/${slug}` });
      await app.close();
      await pool.end();
    }
  });
});