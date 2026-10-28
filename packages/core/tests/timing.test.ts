import { describe, expect, it } from 'vitest';
import {
  computeDueAt,
  defaultDelayMinutes,
  isBusinessDay,
  isWeekend,
  dateKey,
  addBackoffDelay,
} from '@hautomai/core';

describe('timing defaults (spec)', () => {
  it('documents ~2h, checkin 24h, week1 3 days', () => {
    expect(defaultDelayMinutes('send_documents')).toBe(120);
    expect(defaultDelayMinutes('send_checkin')).toBe(1440);
    expect(defaultDelayMinutes('send_week1')).toBe(4320);
    expect(defaultDelayMinutes('send_welcome_email')).toBe(0);
  });
});

describe('business hours', () => {
  const saturday = new Date('2026-09-12T10:00:00Z'); // Saturday
  const sunday = new Date('2026-09-13T10:00:00Z'); // Sunday
  const monday = new Date('2026-09-14T10:00:00Z'); // Monday

  it('detects weekends (spec: no sends on weekends)', () => {
    expect(isWeekend(saturday)).toBe(true);
    expect(isWeekend(sunday)).toBe(true);
    expect(isWeekend(monday)).toBe(false);
    expect(isBusinessDay(monday)).toBe(true);
    expect(isBusinessDay(saturday)).toBe(false);
  });

  it('honours holiday lists as non-business days', () => {
    expect(isBusinessDay(monday, { holidays: ['2026-09-14'] })).toBe(false);
  });

  it('plain (non business-hours) mode just adds the delay', () => {
    const due = computeDueAt(saturday, { delayMinutes: 120 });
    expect(due.toISOString()).toBe('2026-09-12T12:00:00.000Z');
  });

  it('business-hours mode rolls weekend signups forward to the next business day', () => {
    const due = computeDueAt(
      saturday,
      { delayMinutes: 120, businessHoursOnly: true },
      { timezone: 'UTC' },
    );
    expect(isWeekend(due)).toBe(false);
    expect(due.toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });

  it('keeps a weekday due time when it is later than 09:00', () => {
    const due = computeDueAt(
      monday,
      { delayMinutes: 120, businessHoursOnly: true },
      { timezone: 'UTC' },
    );
    expect(due.toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });

  it('dateKey respects timezone', () => {
    expect(dateKey(new Date('2026-09-14T23:30:00Z'), 'UTC')).toBe('2026-09-14');
    expect(dateKey(new Date('2026-09-14T23:30:00Z'), 'America/New_York')).toBe('2026-09-14');
  });
});

describe('addBackoffDelay', () => {
  it('is exponential from the base delay', () => {
    const now = new Date('2026-09-14T09:00:00Z');
    expect(addBackoffDelay(now, 1, 1000).getTime()).toBe(now.getTime() + 1000);
    expect(addBackoffDelay(now, 2, 1000).getTime()).toBe(now.getTime() + 2000);
    expect(addBackoffDelay(now, 3, 1000).getTime()).toBe(now.getTime() + 4000);
  });
});