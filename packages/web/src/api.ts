export type StepId =
  | 'create_crm_contact'
  | 'send_team_alert'
  | 'send_welcome_email'
  | 'send_documents'
  | 'send_checkin'
  | 'send_week1';

export const STEP_IDS: StepId[] = [
  'create_crm_contact',
  'send_team_alert',
  'send_welcome_email',
  'send_documents',
  'send_checkin',
  'send_week1',
];

export type CustomerStatus =
  | 'registered'
  | 'welcome_sent'
  | 'docs_sent'
  | 'checkin_sent'
  | 'week1_sent'
  | 'failed';

export type DocumentSpec = {
  id: string;
  name: string;
  step: StepId;
  fileName: string;
  contentType: string;
  size: number;
  storageKey?: string;
};

export type ClientConfig = {
  name: string;
  trigger: {
    provider: 'webhook' | 'stripe' | 'both';
    webhookToken?: string;
    stripe?: {
      secretKey?: string;
      webhookSecret?: string;
      eventMap: Record<string, string>;
      mapping: Record<string, string>;
    };
    signupSteps: StepId[];
  };
  crm: {
    provider: string;
    fieldMap?: Record<string, string>;
    credentials?: Record<string, unknown>;
  };
  email: {
    provider: string;
    fromName?: string;
    fromEmail?: string;
    subject?: string;
    text?: string;
    html?: string;
    credentials?: Record<string, unknown>;
    templates?: Partial<Record<StepId, { subject?: string; text?: string; html?: string }>>;
  };
  alerts: Array<{ provider: string; label?: string; events: Array<'signup' | 'failed'>; credentials?: Record<string, unknown> }>;
  documents: DocumentSpec[];
  steps: Partial<Record<StepId, { enabled?: boolean; trigger?: 'inbound' | 'scheduler'; scheduler?: { enabled?: boolean; delayMinutes?: number; businessHoursOnly?: boolean } }>>;
  storage: { provider: string; dir?: string; credentials?: Record<string, unknown> };
  timezone: string;
  holidays: string[];
  retry: { maxAttempts: number; baseDelayMs: number };
};

export type Client = {
  id: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  config: ClientConfig;
};

export type Customer = {
  id: string;
  clientSlug: string;
  email: string;
  payload: { customerName: string; email: string; phone?: string; package?: string; signupDate?: string; source?: string };
  status: CustomerStatus;
  completedSteps: Partial<Record<StepId, string>>;
  failed: boolean;
  signupAt: string;
  createdAt: string;
  updatedAt: string;
};

export type StepRun = {
  id: string;
  clientSlug: string;
  customerEmail: string;
  step: StepId;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  attempts: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  runAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const TOKEN_KEY = 'hautomai_admin_token';

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  },
  set token(value: string) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  },
};

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.body && typeof opts.body === 'string') headers['content-type'] = 'application/json';
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const clientApi = {
  list: () => api<Client[]>('/admin/api/clients'),
  create: (name: string, slug?: string) => api<Client>('/admin/api/clients', { method: 'POST', body: JSON.stringify({ name, slug }) }),
  get: (slug: string) => api<Client>(`/admin/api/clients/${slug}`),
  saveConfig: (slug: string, config: unknown) => api<Client>(`/admin/api/clients/${slug}/config`, { method: 'PUT', body: JSON.stringify({ config }) }),
  del: (slug: string) => api<void>(`/admin/api/clients/${slug}`, { method: 'DELETE' }),
  customers: (slug: string, q?: string, status?: string, failed?: string) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (failed !== undefined) p.set('failed', failed);
    return api<Customer[]>(`/admin/api/clients/${slug}/customers?${p.toString()}`);
  },
  customerSteps: (slug: string, email: string) =>
    api<{ customer: Customer; runs: StepRun[]; steps: Record<string, unknown> }>(
      `/admin/api/clients/${slug}/customers/${encodeURIComponent(email)}/steps`,
    ),
  simulate: (slug: string, customer: Record<string, string>, steps?: StepId[]) =>
    api<{ ok: boolean; customerId: string; results: Array<{ step: StepId; status: string; reason?: string; attempts: number }> }>(
      `/admin/api/clients/${slug}/simulate`,
      { method: 'POST', body: JSON.stringify({ customer, steps }) },
    ),
  retry: (slug: string, id: string, step?: StepId) =>
    api<{ ok: boolean; results?: unknown; result?: unknown }>(`/admin/api/clients/${slug}/customers/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ step }),
    }),
  documents: (slug: string) => api<DocumentSpec[]>(`/admin/api/clients/${slug}/documents`),
  uploadDocument: (slug: string, file: File, step: StepId) => {
    const form = new FormData();
    form.append('file', file);
    form.append('step', step);
    return api<{ ok: boolean; document: DocumentSpec; documents: DocumentSpec[] }>(
      `/admin/api/clients/${slug}/documents`,
      { method: 'POST', body: form, headers: {} as Record<string, string> },
    );
  },
  runTick: () => api<{ ok: boolean; fired: number }>('/admin/api/run-tick', { method: 'POST', body: '{}' }),
};

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}