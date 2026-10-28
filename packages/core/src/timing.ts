import type { StepConfig } from './types.js';

const MS_PER_MIN = 60_000;

export type TimingOptions = {
  timezone?: string;
  holidays?: readonly string[];
};

export function dateKey(d: Date, timeZone?: string): string {
  try {
    if (timeZone && timeZone !== 'UTC') {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = fmt.formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    }
  } catch {
    /* invalid timezone -> fall back to UTC */
  }
  return d.toISOString().slice(0, 10);
}

export function weekdayNumber(d: Date, timeZone?: string): number {
  try {
    if (timeZone && timeZone !== 'UTC') {
      const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
      return map[fmt.format(d)] ?? d.getUTCDay();
    }
  } catch {
    /* fall through */
  }
  return d.getUTCDay();
}

export function isWeekend(d: Date, timeZone?: string): boolean {
  const w = weekdayNumber(d, timeZone);
  return w === 0 || w === 6;
}

export function isHoliday(d: Date, holidays: readonly string[] = [], timeZone?: string): boolean {
  return holidays.includes(dateKey(d, timeZone));
}

export function isBusinessDay(d: Date, opts: TimingOptions = {}): boolean {
  return !isWeekend(d, opts.timezone) && !isHoliday(d, opts.holidays, opts.timezone);
}

/** Spec-recommended default delays per step (minutes). */
export function defaultDelayMinutes(step: string): number {
  switch (step) {
    case 'send_documents':
      return 120;
    case 'send_checkin':
      return 1440; // 24h
    case 'send_week1':
      return 4320; // 3 days
    default:
      return 0;
  }
}

/** Resolve the effective delay minutes for a step, honoring config overrides. */
export function delayMinutesForStep(step: string, cfg?: StepConfig): number {
  if (cfg?.scheduler?.delayMinutes !== undefined) {
    return cfg.scheduler.delayMinutes;
  }
  return defaultDelayMinutes(step);
}

export type DueOptions = {
  delayMinutes: number;
  businessHoursOnly?: boolean;
};

/**
 * Computes when a scheduled step becomes due.
 * - plain mode: `from + delayMinutes`
 * - business-hours mode (spec: weekend signups -> Monday, holidays -> next
 *   business day, weekday signups -> the plain delay): rolls forward through
 *   non-business days and clamps to 09:00 of the business day.
 */
export function computeDueAt(
  from: Date,
  dueOptions: DueOptions,
  opts: TimingOptions = {},
): Date {
  let due = new Date(from.getTime() + dueOptions.delayMinutes * MS_PER_MIN);
  if (!dueOptions.businessHoursOnly) {
    return due;
  }
  while (!isBusinessDay(due, opts)) {
    due = new Date(due.getTime() + 24 * 60 * MS_PER_MIN);
  }
  const startOfDay = new Date(due);
  startOfDay.setUTCHours(9, 0, 0, 0);
  return startOfDay.getTime() > due.getTime() ? startOfDay : due;
}

export function addBackoffDelay(now: Date, attempt: number, baseDelayMs: number): Date {
  const ms = baseDelayMs * Math.pow(2, attempt - 1);
  return new Date(now.getTime() + ms);
}