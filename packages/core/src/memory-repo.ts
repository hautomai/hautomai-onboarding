import { randomUUID } from 'node:crypto';
import type {
  Client,
  ClientConfig,
  Customer,
  CustomerPayload,
  StepId,
  StepRun,
  StepStatus,
} from './types.js';
import { defaultClientConfig, deriveCustomerStatus, slugify } from './config.js';
import type { CustomerFilter, Repository } from './repo.js';

type CustomerRow = Customer;
type StepRunRow = StepRun;
type ClientRow = Client;

/**
 * In-memory implementation of Repository. Used for tests and as the reference
 * implementation any real repository must match.
 */
export class MemoryRepository implements Repository {
  private clients = new Map<string, ClientRow>();
  private customers = new Map<string, CustomerRow>();
  private runs = new Map<string, StepRunRow>();

  constructor(seed?: Partial<Pick<Repository, 'upsertCustomer'>>) {
    void seed;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // ---- clients -----------------------------------------------------------

  async listClients(): Promise<Client[]> {
    return [...this.clients.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getClientBySlug(slug: string): Promise<Client | null> {
    for (const c of this.clients.values()) {
      if (c.slug === slug) return c;
    }
    return null;
  }

  async getClientById(id: string): Promise<Client | null> {
    return this.clients.get(id) ?? null;
  }

  async createClient(input: { name: string; slug: string }): Promise<Client> {
    const slug = slugify(input.slug || input.name);
    if (await this.getClientBySlug(slug)) {
      const err = new Error(`Client with slug "${slug}" already exists.`) as Error & { code?: string };
      err.code = 'P2002';
      throw err;
    }
    const now = new Date().toISOString();
    const client: ClientRow = {
      id: randomUUID(),
      slug,
      createdAt: now,
      updatedAt: now,
      config: defaultClientConfig(input.name),
    };
    this.clients.set(client.id, client);
    return client;
  }

  async updateClientConfig(id: string, config: ClientConfig): Promise<Client> {
    const existing = this.clients.get(id);
    if (!existing) throw new Error('Client not found');
    const updated: ClientRow = { ...existing, config, updatedAt: new Date().toISOString() };
    this.clients.set(id, updated);
    return updated;
  }

  async deleteClient(id: string): Promise<void> {
    const client = this.clients.get(id);
    this.clients.delete(id);
    if (client) {
      for (const [cid, c] of this.customers) {
        if (c.clientSlug === client.slug) this.customers.delete(cid);
      }
      for (const [rid, r] of this.runs) {
        if (r.clientSlug === client.slug) this.runs.delete(rid);
      }
    }
  }

  // ---- customers ----------------------------------------------------------

  async upsertCustomer(clientSlug: string, payload: CustomerPayload): Promise<Customer> {
    const existing = await this.getCustomer(clientSlug, payload.email);
    const now = new Date().toISOString();
    if (existing) {
      const updated: CustomerRow = {
        ...existing,
        payload,
        updatedAt: now,
      };
      this.customers.set(existing.id, updated);
      return updated;
    }
    const customer: CustomerRow = {
      id: randomUUID(),
      clientSlug,
      email: payload.email,
      payload,
      status: 'registered',
      completedSteps: {},
      failed: false,
      signupAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  async getCustomer(clientSlug: string, email: string): Promise<Customer | null> {
    for (const c of this.customers.values()) {
      if (c.clientSlug === clientSlug && c.email.toLowerCase() === email.toLowerCase()) return c;
    }
    return null;
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    return this.customers.get(id) ?? null;
  }

  async listCustomers(filter?: CustomerFilter): Promise<Customer[]> {
    let rows = [...this.customers.values()];
    if (filter?.clientSlug) rows = rows.filter((c) => c.clientSlug === filter.clientSlug);
    if (filter?.status) rows = rows.filter((c) => c.status === filter.status);
    if (filter?.failed !== undefined) rows = rows.filter((c) => c.failed === filter.failed);
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.payload.customerName.toLowerCase().includes(q) ||
          c.payload.package?.toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateCustomerCompletion(id: string, completedStep: StepId, when: string): Promise<Customer> {
    const existing = this.customers.get(id);
    if (!existing) throw new Error('Customer not found');
    const completedSteps = { ...existing.completedSteps, [completedStep]: when };
    const next: CustomerRow = {
      ...existing,
      completedSteps,
      status: deriveCustomerStatus(completedSteps),
      updatedAt: new Date().toISOString(),
    };
    this.customers.set(id, next);
    return next;
  }

  async setCustomerFailed(id: string, failed: boolean): Promise<Customer> {
    const existing = this.customers.get(id);
    if (!existing) throw new Error('Customer not found');
    const next: CustomerRow = { ...existing, failed, updatedAt: new Date().toISOString() };
    this.customers.set(id, next);
    return next;
  }

  // ---- step runs -----------------------------------------------------------

  async createStepRun(input: {
    clientSlug: string;
    customerEmail: string;
    step: StepId;
  }): Promise<StepRun> {
    const now = new Date().toISOString();
    const run: StepRunRow = {
      id: randomUUID(),
      clientSlug: input.clientSlug,
      customerEmail: input.customerEmail,
      step: input.step,
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      runAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async listStepRuns(filter?: {
    clientSlug?: string;
    customerEmail?: string;
    status?: StepStatus;
  }): Promise<StepRun[]> {
    let rows = [...this.runs.values()];
    if (filter?.clientSlug) rows = rows.filter((r) => r.clientSlug === filter.clientSlug);
    if (filter?.customerEmail) rows = rows.filter((r) => r.customerEmail === filter.customerEmail);
    if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getLastStepRun(
    clientSlug: string,
    customerEmail: string,
    step: StepId,
  ): Promise<StepRun | null> {
    const matches = (await this.listStepRuns({ clientSlug, customerEmail })).filter(
      (r) => r.step === step,
    );
    return matches[0] ?? null;
  }

  async updateStepRun(
    id: string,
    patch: Partial<Pick<StepRun, 'status' | 'attempts' | 'lastError' | 'nextAttemptAt' | 'runAt'>>,
  ): Promise<StepRun> {
    const existing = this.runs.get(id);
    if (!existing) throw new Error('StepRun not found');
    const next: StepRunRow = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.runs.set(id, next);
    return next;
  }

  /** Test helper. */
  seedCustomer(...rows: Customer[]): void {
    for (const c of rows) this.customers.set(c.id, c);
  }
}

export type { StepStatus };

export { deriveCustomerStatus };