export type CustomerPayload = {
  customerName: string;
  email: string;
  phone?: string;
  package?: string;
  signupDate?: string;
  source?: string;
};

export type StepId =
  | 'create_crm_contact'
  | 'send_team_alert'
  | 'send_welcome_email'
  | 'send_documents'
  | 'send_checkin'
  | 'send_week1';

export const STEP_IDS: readonly StepId[] = [
  'create_crm_contact',
  'send_team_alert',
  'send_welcome_email',
  'send_documents',
  'send_checkin',
  'send_week1',
];

export type StepStatus = 'pending' | 'success' | 'failed' | 'skipped';

export type CustomerStatus =
  | 'registered'
  | 'welcome_sent'
  | 'docs_sent'
  | 'checkin_sent'
  | 'week1_sent'
  | 'failed';

export const STEP_ORDER: readonly StepId[] = [
  'create_crm_contact',
  'send_team_alert',
  'send_welcome_email',
  'send_documents',
  'send_checkin',
  'send_week1',
];

export type TriggerKind = 'inbound' | 'scheduler';

export type SchedulerConfig = {
  enabled?: boolean;
  delayMinutes?: number;
  businessHoursOnly?: boolean;
  dueTime?: string;
};

export type StepConfig = {
  enabled: boolean;
  trigger: TriggerKind;
  scheduler?: SchedulerConfig;
};

export type AlertEvent = 'signup' | 'failed';

export type AlertChannelConfig = {
  provider: string;
  label?: string;
  events: AlertEvent[];
  credentials?: Record<string, unknown>;
};

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
    templates?: Partial<
      Record<
        StepId,
        {
          subject?: string;
          text?: string;
          html?: string;
        }
      >
    >;
  };
  alerts: AlertChannelConfig[];
  documents: DocumentSpec[];
  steps: Partial<Record<StepId, StepConfig>>;
  storage: {
    provider: string;
    dir?: string;
    credentials?: Record<string, unknown>;
  };
  timezone: string;
  holidays: string[];
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
  };
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
  payload: CustomerPayload;
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
  status: StepStatus;
  attempts: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  runAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type Logger = {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
};

export const noopLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};