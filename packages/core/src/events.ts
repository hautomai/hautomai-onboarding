import type { CustomerPayload, StepId } from './types.js';

export type TriggerSource = 'webhook' | 'stripe' | 'scheduler' | 'admin';

export type EventEnvelope = {
  clientSlug: string;
  provider: TriggerSource;
  /** Steps that fired into this event. When omitted, the client signupSteps apply. */
  steps: StepId[];
  customer: CustomerPayload;
  receivedAt: string;
};

export type NewCustomerEventInput = {
  customer: CustomerPayload;
  steps?: StepId[];
  provider?: TriggerSource;
};