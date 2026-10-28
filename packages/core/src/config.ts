import { z } from 'zod';
import type { ClientConfig, CustomerStatus, StepId } from './types.js';

/** Steps fired when a signup event arrives (webhook/stripe), in order. */
export const DEFAULT_SIGNUP_STEPS: StepId[] = [
  'create_crm_contact',
  'send_team_alert',
  'send_welcome_email',
];

const StepIdEnum = z.enum([
  'create_crm_contact',
  'send_team_alert',
  'send_welcome_email',
  'send_documents',
  'send_checkin',
  'send_week1',
]);

const SchedulerConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  delayMinutes: z.number().int().nonnegative().optional(),
  businessHoursOnly: z.boolean().optional().default(false),
  dueTime: z.string().optional(),
});

const StepConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  trigger: z.enum(['inbound', 'scheduler']).optional().default('inbound'),
  scheduler: SchedulerConfigSchema.optional(),
});

const CredentialsSchema = z.record(z.string(), z.unknown());

const TriggerConfigSchema = z.object({
  provider: z.enum(['webhook', 'stripe', 'both']).optional().default('webhook'),
  webhookToken: z.string().optional(),
  stripe: z
    .object({
      secretKey: z.string().optional(),
      webhookSecret: z.string().optional(),
      eventMap: z.record(z.string(), z.string()).optional().default({}),
      mapping: z.record(z.string(), z.string()).optional().default({}),
    })
    .optional(),
  signupSteps: z.array(StepIdEnum).optional().default(DEFAULT_SIGNUP_STEPS),
});

export const DEFAULT_EVENT_MAP: Record<string, string> = {
  'customer.subscription.created': 'signup',
  'checkout.session.completed': 'signup',
  'invoice.paid': 'signup',
  'customer.created': 'signup',
};

export const DEFAULT_FIELD_MAP: Record<string, string> = {
  package: 'package',
  signup_date: 'signup_date',
  source: 'signup_source',
  onboarding_status: 'onboarding_status',
};

const CrmConfigSchema = z.object({
  provider: z.string().optional().default('memory'),
  fieldMap: z.record(z.string(), z.string()).optional().default(DEFAULT_FIELD_MAP),
  credentials: CredentialsSchema.optional(),
});

const EmailTemplateSchema = z.object({
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
});

const EmailConfigSchema = z.object({
  provider: z.string().optional().default('memory'),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  credentials: CredentialsSchema.optional(),
  templates: z.record(StepIdEnum, EmailTemplateSchema).optional().default({}),
});

const AlertChannelSchema = z.object({
  provider: z.string().min(1),
  label: z.string().optional(),
  events: z.array(z.enum(['signup', 'failed'])).optional().default(['signup']),
  credentials: CredentialsSchema.optional(),
});

const DocumentSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  step: StepIdEnum.default('send_documents'),
  fileName: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  storageKey: z.string().optional(),
});

const StorageConfigSchema = z.object({
  provider: z.string().optional().default('disk'),
  dir: z.string().optional(),
  credentials: CredentialsSchema.optional(),
});

const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().min(1).default(3),
  baseDelayMs: z.number().int().min(0).default(1000),
});

export const ClientConfigSchema = z.object({
  name: z.string().min(1).default('New client'),
  trigger: TriggerConfigSchema.default({}),
  crm: CrmConfigSchema.default({}),
  email: EmailConfigSchema.default({}),
  alerts: z.array(AlertChannelSchema).default([]),
  documents: z.array(DocumentSpecSchema).default([]),
  steps: z.record(StepIdEnum, StepConfigSchema).optional().default({}),
  storage: StorageConfigSchema.default({}),
  timezone: z.string().default('UTC'),
  holidays: z.array(z.string()).default([]),
  retry: RetryConfigSchema.default({}),
});

export const CustomerPayloadSchema = z.object({
  customerName: z.string().min(1, 'customerName is required'),
  email: z.string().email('email must be a valid email address'),
  phone: z.string().optional().default(''),
  package: z.string().optional().default(''),
  signupDate: z.string().optional().default(''),
  source: z.string().optional().default(''),
});

export function parseClientConfig(input: unknown): ClientConfig {
  return ClientConfigSchema.parse(input ?? {}) as ClientConfig;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'client';
}

export function defaultClientConfig(name: string): ClientConfig {
  return parseClientConfig({ name });
}

export function defaultStepConfig(_step: StepId) {
  return { enabled: true, trigger: 'inbound' as const };
}

/** Human readable status derived from the furthest completed onboarding step. */
export function deriveCustomerStatus(
  completed: Partial<Record<StepId, string>>,
): CustomerStatus {
  const map: Array<[StepId, CustomerStatus]> = [
    ['send_week1', 'week1_sent'],
    ['send_checkin', 'checkin_sent'],
    ['send_documents', 'docs_sent'],
    ['send_welcome_email', 'welcome_sent'],
  ];
  for (const [step, status] of map) {
    if (completed[step]) return status;
  }
  return 'registered';
}

export function completedStepFromStatus(status: string): StepId | undefined {
  switch (status) {
    case 'week1_sent':
      return 'send_week1';
    case 'checkin_sent':
      return 'send_checkin';
    case 'docs_sent':
      return 'send_documents';
    case 'welcome_sent':
      return 'send_welcome_email';
    default:
      return undefined;
  }
}