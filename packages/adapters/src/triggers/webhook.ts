import {
  CustomerPayloadSchema,
  STEP_IDS,
  DEFAULT_SIGNUP_STEPS,
  type Client,
  type CustomerPayload,
  type StepId,
} from '@hautomai/core';

export type WebhookPayload = {
  customer: CustomerPayload;
  steps?: StepId[];
};

/**
 * Parses/normalizes a generic webhook body into a validated customer payload.
 * Accepts either flat fields (the spec shape) or a nested { customer, steps }.
 */
export function parseWebhookPayload(body: unknown): CustomerPayload | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const raw = 'customer' in record && typeof record.customer === 'object' ? record.customer : record;
  const parsed = CustomerPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

export function resolveSteps(payload: { steps?: unknown }, client: Client): StepId[] {
  if (Array.isArray(payload.steps) && payload.steps.length > 0) {
    const valid = payload.steps.filter((s): s is StepId =>
      STEP_IDS.includes(s as StepId),
    );
    if (valid.length > 0) return valid;
  }
  const configured = client.config.trigger.signupSteps;
  return configured.length > 0 ? configured : DEFAULT_SIGNUP_STEPS;
}

export type { CustomerPayload, StepId };