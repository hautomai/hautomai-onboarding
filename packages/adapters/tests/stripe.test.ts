import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyStripeSignature,
  extractCustomerFromEvent,
} from '@hautomai/adapters';
import { DEFAULT_SIGNUP_STEPS } from '@hautomai/core';

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret_123';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });

  function signedHeader(timestamp: string, value: string): string {
    return `t=${timestamp},v1=${value}`;
  }

  it('verifies a genuine v1 signature', () => {
    const t = '1699999999';
    const expected = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
    expect(verifyStripeSignature(body, signedHeader(t, expected), secret)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    const other = createHmac('sha256', 'other-secret').update(`1699999999.${body}`, 'utf8').digest('hex');
    expect(verifyStripeSignature(body, signedHeader('1699999999', other), secret)).toBe(false);
  });

  it('rejects a missing header when a secret is configured', () => {
    expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
  });

  it('accepts when no secret is set (verification placeholder)', () => {
    expect(verifyStripeSignature(body, undefined, '')).toBe(true);
  });
});

describe('extractCustomerFromEvent', () => {
  it('maps checkout.session.completed to the signup steps', () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          customer_details: { name: 'Ada Lovelace', email: 'ada@example.com' },
          metadata: { package: 'Basic', source: 'site' },
        },
      },
    };
    const out = extractCustomerFromEvent(event, {}, DEFAULT_SIGNUP_STEPS);
    expect(out).not.toBeNull();
    expect(out?.steps).toEqual(DEFAULT_SIGNUP_STEPS);
    expect(out?.customer.email).toBe('ada@example.com');
    expect(out?.customer.customerName).toBe('Ada Lovelace');
    expect(out?.customer.package).toBe('Basic');
  });

  it('uses a configured event map to target a single step', () => {
    const event = { type: 'invoice.paid', data: { object: { email: 'bill@example.com' } } };
    const out = extractCustomerFromEvent(
      event,
      { 'invoice.paid': 'send_documents' },
      DEFAULT_SIGNUP_STEPS,
    );
    expect(out?.steps).toEqual(['send_documents']);
  });

  it('returns null when no email is present', () => {
    const event = { type: 'customer.deleted', data: { object: { id: 'cus_1' } } };
    expect(extractCustomerFromEvent(event, {})).toBeNull();
  });
});