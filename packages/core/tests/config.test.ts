import { describe, expect, it } from 'vitest';
import {
  parseClientConfig,
  defaultClientConfig,
  slugify,
  deriveCustomerStatus,
  CustomerPayloadSchema,
} from '@hautomai/core';

describe('parseClientConfig', () => {
  it('applies spec defaults when config is empty', () => {
    const cfg = parseClientConfig({});
    expect(cfg.name).toBe('New client');
    expect(cfg.trigger.provider).toBe('webhook');
    expect(cfg.crm.provider).toBe('memory');
    expect(cfg.email.provider).toBe('memory');
    expect(cfg.storage.provider).toBe('disk');
    expect(cfg.retry.maxAttempts).toBe(3);
    expect(cfg.retry.baseDelayMs).toBe(1000);
    expect(cfg.trigger.signupSteps).toEqual([
      'create_crm_contact',
      'send_team_alert',
      'send_welcome_email',
    ]);
  });

  it('keeps provided steps and credentials', () => {
    const cfg = parseClientConfig({
      steps: {
        send_checkin: {
          enabled: true,
          trigger: 'scheduler',
          scheduler: { enabled: true, delayMinutes: 1440, businessHoursOnly: true },
        },
      },
      crm: { provider: 'hubspot', credentials: { accessToken: 'abc' } },
    });
    expect(cfg.steps.send_checkin?.trigger).toBe('scheduler');
    expect(cfg.steps.send_checkin?.scheduler?.delayMinutes).toBe(1440);
    expect(cfg.crm.provider).toBe('hubspot');
    expect(cfg.crm.credentials?.accessToken).toBe('abc');
  });

  it('rejects unknown step ids', () => {
    expect(() =>
      parseClientConfig({ trigger: { signupSteps: ['not_a_step' as never] } }),
    ).toThrow();
  });
});

describe('defaultClientConfig', () => {
  it('sets the client name', () => {
    expect(defaultClientConfig('Acme').name).toBe('Acme');
  });
});

describe('slugify', () => {
  it('lowercases and normalizes', () => {
    expect(slugify('Acme Beauty & Co')).toBe('acme-beauty-co');
    expect(slugify('  HÄUUTO!! ')).toBe('h-uuto');
    expect(slugify('')).toBe('client');
  });
});

describe('deriveCustomerStatus', () => {
  it('walks the onboarding ladder', () => {
    expect(deriveCustomerStatus({})).toBe('registered');
    expect(deriveCustomerStatus({ send_welcome_email: 't' })).toBe('welcome_sent');
    expect(deriveCustomerStatus({ send_documents: 't' })).toBe('docs_sent');
    expect(deriveCustomerStatus({ send_checkin: 't' })).toBe('checkin_sent');
    expect(deriveCustomerStatus({ send_week1: 't' })).toBe('week1_sent');
  });
});

describe('CustomerPayloadSchema', () => {
  it('validates the spec payload shape', () => {
    const ok = CustomerPayloadSchema.safeParse({
      customerName: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.email).toBe('ada@example.com');
  });

  it('rejects missing email/name', () => {
    expect(CustomerPayloadSchema.safeParse({ customerName: '' }).success).toBe(false);
    expect(CustomerPayloadSchema.safeParse({ customerName: 'X' }).success).toBe(false);
    expect(CustomerPayloadSchema.safeParse({ customerName: 'X', email: 'nope' }).success).toBe(false);
  });
});