import type {
  Client,
  ClientConfig,
  Customer,
  CustomerPayload,
  StepId,
  StepRun,
  StepStatus,
} from './types.js';

export type CustomerFilter = {
  clientSlug?: string;
  status?: string;
  q?: string;
  failed?: boolean;
};

export interface Repository {
  // clients
  listClients(): Promise<Client[]>;
  getClientBySlug(slug: string): Promise<Client | null>;
  getClientById(id: string): Promise<Client | null>;
  createClient(input: { name: string; slug: string }): Promise<Client>;
  updateClientConfig(id: string, config: ClientConfig): Promise<Client>;
  deleteClient(id: string): Promise<void>;

  // customers
  upsertCustomer(clientSlug: string, payload: CustomerPayload): Promise<Customer>;
  getCustomer(clientSlug: string, email: string): Promise<Customer | null>;
  getCustomerById(id: string): Promise<Customer | null>;
  listCustomers(filter?: CustomerFilter): Promise<Customer[]>;
  /** Record a completed step and recompute the customer status. */
  updateCustomerCompletion(id: string, completedStep: StepId, when: string): Promise<Customer>;
  setCustomerFailed(id: string, failed: boolean): Promise<Customer>;

  // step runs
  createStepRun(input: {
    clientSlug: string;
    customerEmail: string;
    step: StepId;
  }): Promise<StepRun>;
  listStepRuns(filter?: {
    clientSlug?: string;
    customerEmail?: string;
    status?: StepStatus;
  }): Promise<StepRun[]>;
  getLastStepRun(clientSlug: string, customerEmail: string, step: StepId): Promise<StepRun | null>;
  updateStepRun(
    id: string,
    patch: Partial<Pick<StepRun, 'status' | 'attempts' | 'lastError' | 'nextAttemptAt' | 'runAt'>>,
  ): Promise<StepRun>;
}