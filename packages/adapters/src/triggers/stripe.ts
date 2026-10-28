import { createHmac } from 'node:crypto';
import { DEFAULT_SIGNUP_STEPS, safeEqual, type CustomerPayload, type StepId } from '@hautomai/core';

/** Constant-time Stripe signature verification (v1). Placeholder when no secret. */
export function verifyStripeSignature(
  payload: string | Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string | undefined,
): boolean {
  if (!webhookSecret) {
    // AUTH/verify placeholder: once the client provides a webhook secret this
    // activates. Until then, signatures are not enforced so the sandbox can run.
    return true;
  }
  if (!signatureHeader) return false;
  let timestamp = '';
  let signature = '';
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't') timestamp = value ?? '';
    if (key === 'v1') signature = value ?? '';
  }
  if (!timestamp || !signature) return false;
  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  return safeEqual(expected, signature);
}

export type StripeEventObject = Record<string, any>;

export type StripeCustomerPayload = {
  steps: StepId[];
  customer: CustomerPayload;
};

/**
 * Maps a raw Stripe webhook event to an onboarding payload.
 * Returns null when no customer email can be derived (422 upstream).
 */
export function extractCustomerFromEvent(
  event: StripeEventObject,
  eventMap: Record<string, string>,
  signupSteps: StepId[] = DEFAULT_SIGNUP_STEPS,
): StripeCustomerPayload | null {
  const type: string | undefined = event?.type;
  const target: string = (type && eventMap?.[type]) || 'signup';
  const obj: StripeEventObject = event?.data?.object ?? event?.object ?? {};
  const nested = obj?.customer_object ?? obj;
  const email =
    obj?.customer_email ??
    obj?.customer_details?.email ??
    obj?.email ??
    obj?.metadata?.email ??
    nested?.email ??
    obj?.customer?.email ??
    undefined;
  if (!email || typeof email !== 'string') return null;
  const name: string =
    obj?.customer_details?.name ?? obj?.name ?? nested?.name ?? email.split('@')[0] ?? '';
  const steps: StepId[] = target === 'signup' ? [...signupSteps] : ([target] as StepId[]);
  return {
    steps,
    customer: {
      customerName: name,
      email,
      phone: obj?.customer_details?.phone ?? obj?.phone ?? '',
      package: obj?.metadata?.package ?? '',
      signupDate: obj?.signupDate ?? '',
      source: obj?.metadata?.source ?? '',
    },
  };
}