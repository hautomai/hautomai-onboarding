import { describe, expect, it } from 'vitest';
import { parseWebhookPayload, resolveSteps } from '@hautomai/adapters';
import { defaultClientConfig, type Client, type ClientConfig } from '@hautomai/core';

const clientConfig: ClientConfig = defaultClientConfig('Acme');

const client: Client = {
  id: 'x',
  slug: 'acme',
  config: clientConfig,
  createdAt: 't',
  updatedAt: 't',
};

describe('parseWebhookPayload', () => {
  it('parses the flat spec payload', () => {
    const payload = parseWebhookPayload({
      customerName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+33600000000',
      package: 'Basic',
      source: 'referral',
    });
    expect(payload?.customerName).toBe('Ada Lovelace');
    expect(payload?.email).toBe('ada@example.com');
    expect(payload?.phone).toBe('+33600000000');
  });

  it('parses a nested { customer, steps } payload', () => {
    const payload = parseWebhookPayload({
      customer: { customerName: 'Grace', email: 'grace@example.com' },
      steps: ['send_welcome_email'],
    });
    expect(payload?.customerName).toBe('Grace');
  });

  it('rejects invalid payloads politely', () => {
    expect(parseWebhookPayload(null)).toBeNull();
    expect(parseWebhookPayload({ customerName: '' })).toBeNull();
    expect(parseWebhookPayload({ email: 'nope' })).toBeNull();
    expect(parseWebhookPayload('just a string')).toBeNull();
  });
});

describe('resolveSteps', () => {
  it('prefers body steps when valid', () => {
    const steps = resolveSteps({ steps: ['send_checkin', 'send_documents'] }, client);
    expect(steps).toEqual(['send_checkin', 'send_documents']);
  });

  it('drops unknown step ids from the body', () => {
    const steps = resolveSteps({ steps: ['send_week1', 'bogus'] }, client);
    expect(steps).toEqual(['send_week1']);
  });

  it('falls back to the client signup steps', () => {
    const steps = resolveSteps({}, client);
    expect(steps).toEqual([
      'create_crm_contact',
      'send_team_alert',
      'send_welcome_email',
    ]);
  });

  it('falls back when only invalid steps are provided', () => {
    const steps = resolveSteps({ steps: ['nope'] }, client);
    expect(steps).toEqual(client.config.trigger.signupSteps);
  });
});