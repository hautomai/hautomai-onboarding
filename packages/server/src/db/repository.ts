import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  type Client,
  type ClientConfig,
  type Customer,
  type CustomerPayload,
  type CustomerStatus,
  type Repository,
  type StepId,
  type StepRun,
  type StepStatus,
} from '@hautomai/core';
import { decryptJson, encryptJson, deriveCustomerStatus, parseClientConfig } from '@hautomai/core';

const ERR_UNIQUE_VIOLATION = '23505';

function mapClient(row: {
  id: string;
  slug: string;
  name: string;
  config_enc: string;
  created_at: Date;
  updated_at: Date;
}, encKey: string): Client {
  return {
    id: row.id,
    slug: row.slug,
    // Normalize on read so legacy rows (created before defaults were stored)
    // still carry the full config axiom.
    config: parseClientConfig(decryptJson<ClientConfig>(encKey, row.config_enc)), // requires ENC_KEY
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapCustomer(row: {
  id: string;
  client_slug: string;
  email: string;
  payload: CustomerPayload;
  status: string;
  completed_steps: Partial<Record<StepId, string>>;
  failed: boolean;
  signup_at: Date;
  created_at: Date;
  updated_at: Date;
}): Customer {
  return {
    id: row.id,
    clientSlug: row.client_slug,
    email: row.email,
    payload: row.payload,
    status: row.status as CustomerStatus,
    completedSteps: row.completed_steps,
    failed: row.failed,
    signupAt: row.signup_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapStepRun(row: {
  id: string;
  client_slug: string;
  customer_email: string;
  step: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): StepRun {
  return {
    id: row.id,
    clientSlug: row.client_slug,
    customerEmail: row.customer_email,
    step: row.step as StepId,
    status: row.status as StepStatus,
    attempts: row.attempts,
    lastError: row.last_error ?? null,
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    runAt: row.run_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgRepository implements Repository {
  private pool: pg.Pool;
  private encKey: string;

  constructor(pool: pg.Pool, encKey: string) {
    this.pool = pool;
    this.encKey = encKey;
  }

  // ---- clients ----

  async listClients(): Promise<Client[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM clients ORDER BY created_at DESC',
    );
    return rows
      .map((r) => {
        try {
          return mapClient(r, this.encKey);
        } catch {
          return null; // skip rows encrypted under a different ENC_KEY
        }
      })
      .filter((c): c is Client => c !== null);
  }

  async getClientBySlug(slug: string): Promise<Client | null> {
    const { rows } = await this.pool.query('SELECT * FROM clients WHERE slug = $1', [slug]);
    return rows[0] ? mapClient(rows[0], this.encKey) : null;
  }

  async getClientById(id: string): Promise<Client | null> {
    const { rows } = await this.pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    return rows[0] ? mapClient(rows[0], this.encKey) : null;
  }

  async createClient(input: { slug: string; name: string; config?: Partial<ClientConfig> }): Promise<Client> {
    const id = randomUUID();
    const config = parseClientConfig({ ...(input.config ?? {}), name: input.config?.name ?? input.name });
    const encoded = encryptJson(this.encKey, config);
    try {
      await this.pool.query(
        'INSERT INTO clients (id, slug, name, config_enc) VALUES ($1, $2, $3, $4)',
        [id, input.slug, input.name, encoded],
      );
    } catch (err) {
      if ((err as { code?: string }).code === ERR_UNIQUE_VIOLATION) {
        throw new Error(`A client with slug "${input.slug}" already exists.`);
      }
      throw err;
    }
    return (await this.getClientById(id)) as Client;
  }

  async updateClientConfig(id: string, config: ClientConfig): Promise<Client> {
    const encoded = encryptJson(this.encKey, config);
    const { rows } = await this.pool.query(
      'UPDATE clients SET config_enc = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, encoded],
    );
    if (!rows[0]) throw new Error('Client not found.');
    return mapClient(rows[0], this.encKey);
  }

  async deleteClient(id: string): Promise<void> {
    await this.pool.query('BEGIN');
    try {
      const { rows } = await this.pool.query('SELECT slug FROM clients WHERE id = $1', [id]);
      const slug = rows[0]?.slug;
      if (!slug) {
        await this.pool.query('ROLLBACK');
        return;
      }
      await this.pool.query('DELETE FROM step_runs WHERE client_slug = $1', [slug]);
      await this.pool.query('DELETE FROM customers WHERE client_slug = $1', [slug]);
      await this.pool.query('DELETE FROM clients WHERE id = $1', [id]);
      await this.pool.query('COMMIT');
    } catch (err) {
      await this.pool.query('ROLLBACK');
      throw err;
    }
  }

  // ---- customers ----

  async upsertCustomer(clientSlug: string, payload: CustomerPayload): Promise<Customer> {
    const { rows } = await this.pool.query(
      `INSERT INTO customers (id, client_slug, email, payload, status, completed_steps)
       VALUES ($1, $2, $3, $4, 'pending', '{}'::jsonb)
       ON CONFLICT (client_slug, email) DO UPDATE
         SET payload = EXCLUDED.payload, updated_at = now()
       RETURNING *`,
      [randomUUID(), clientSlug, payload.email, JSON.stringify(payload)],
    );
    return mapCustomer(rows[0]);
  }

  async getCustomer(clientSlug: string, email: string): Promise<Customer | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM customers WHERE client_slug = $1 AND email = $2',
      [clientSlug, email],
    );
    return rows[0] ? mapCustomer(rows[0]) : null;
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    const { rows } = await this.pool.query('SELECT * FROM customers WHERE id = $1', [id]);
    return rows[0] ? mapCustomer(rows[0]) : null;
  }

  async listCustomers(filter: { clientSlug?: string; status?: string; failed?: boolean; q?: string } = {}): Promise<Customer[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.clientSlug) {
      params.push(filter.clientSlug);
      conditions.push(`client_slug = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.failed !== undefined) {
      params.push(filter.failed);
      conditions.push(`failed = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q.toLowerCase()}%`);
      conditions.push(`(email ILIKE $${params.length} OR payload->>'customerName' ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(`SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT 500`, params);
    return rows.map(mapCustomer);
  }

  async updateCustomerCompletion(id: string, step: StepId, when: string): Promise<Customer> {
    // merge jsonb in a single UPDATE so concurrent step completions never
    // clobber each other (lost-update on the read-modify-write)
    const { rows } = await this.pool.query(
      `UPDATE customers
         SET completed_steps = completed_steps || jsonb_build_object($2::text, to_jsonb($3::text)),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, step, when],
    );
    const customer = mapCustomer(rows[0]);
    return this.setStatusFromSteps(customer.id).then(() => customer);
  }

  async setCustomerFailed(id: string, failed = true): Promise<Customer> {
    const { rows } = await this.pool.query(
      'UPDATE customers SET failed = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, failed],
    );
    return mapCustomer(rows[0]);
  }

  private async setStatusFromSteps(id: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT completed_steps FROM customers WHERE id = $1', [id]);
    const steps = rows[0]?.completed_steps ?? {};
    await this.pool.query('UPDATE customers SET status = $2, updated_at = now() WHERE id = $1', [
      id,
      deriveCustomerStatus(steps),
    ]);
  }

  // ---- step runs ----

  async createStepRun(input: { clientSlug: string; customerEmail: string; step: StepId; status?: StepStatus }): Promise<StepRun> {
    const { rows } = await this.pool.query(
      `INSERT INTO step_runs
        (id, client_slug, customer_email, step, status, attempts, run_at)
       VALUES ($1,$2,$3,$4,$5,0,$6)
       RETURNING *`,
      [
        randomUUID(),
        input.clientSlug,
        input.customerEmail,
        input.step,
        input.status ?? 'pending',
        input.status === 'success' ? new Date().toISOString() : null,
      ],
    );
    return mapStepRun(rows[0]);
  }

  async getLastStepRun(clientSlug: string, customerEmail: string, step: StepId): Promise<StepRun | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM step_runs
       WHERE client_slug = $1 AND customer_email = $2 AND step = $3
       ORDER BY created_at DESC LIMIT 1`,
      [clientSlug, customerEmail, step],
    );
    return rows[0] ? mapStepRun(rows[0]) : null;
  }

  async listStepRuns(filter: { clientSlug?: string; customerEmail?: string; step?: StepId; status?: StepStatus } = {}): Promise<StepRun[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.clientSlug) {
      params.push(filter.clientSlug);
      conditions.push(`client_slug = $${params.length}`);
    }
    if (filter.customerEmail) {
      params.push(filter.customerEmail);
      conditions.push(`customer_email = $${params.length}`);
    }
    if (filter.step) {
      params.push(filter.step);
      conditions.push(`step = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(`SELECT * FROM step_runs ${where} ORDER BY created_at DESC LIMIT 500`, params);
    return rows.map(mapStepRun);
  }

  async updateStepRun(id: string, patch: { status?: StepStatus; attempts?: number; lastError?: string | null; nextAttemptAt?: string | null; runAt?: string | null }): Promise<StepRun> {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    const set = (field: string, value: unknown) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };
    if (patch.status !== undefined) set('status', patch.status);
    if (patch.attempts !== undefined) set('attempts', patch.attempts);
    if (patch.lastError !== undefined) set('last_error', patch.lastError);
    if (patch.nextAttemptAt !== undefined) set('next_attempt_at', patch.nextAttemptAt);
    if (patch.runAt !== undefined) set('run_at', patch.runAt);
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE step_runs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return mapStepRun(rows[0]);
  }
}