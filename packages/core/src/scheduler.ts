import type { Client, StepConfig, StepId } from './types.js';
import type { Repository } from './repo.js';
import type { ProviderFactory } from './providers.js';
import type { Logger } from './types.js';
import { noopLogger } from './types.js';
import { delayMinutesForStep, computeDueAt } from './timing.js';
import { defaultStepConfig } from './config.js';
import { StepEngine } from './engine.js';

export type SchedulerOptions = {
  logger?: Logger;
  clock?: () => Date;
  baseUrl?: string;
};

/**
 * Trigger that fires "scheduled" steps. Instead of long-running waits, a small
 * poll scans for customers whose next scheduled step is due and fires it as a
 * fresh trigger event. Business-hour aware, per the onboarding spec.
 */
export class Scheduler {
  private clock: () => Date;
  private logger: Logger;
  private engine: StepEngine;

  constructor(
    private deps: {
      repo: Repository;
      factory: ProviderFactory;
      engine?: StepEngine;
    },
    opts: SchedulerOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date());
    this.logger = opts.logger ?? noopLogger;
    this.engine =
      deps.engine ??
      new StepEngine(
        { repo: deps.repo, factory: deps.factory },
        { logger: this.logger, clock: this.clock, baseUrl: opts.baseUrl },
      );
  }

  /** Compute the due date for a scheduled step (wraps core timing). */
  dueAt(client: Client, step: StepId, cfg: StepConfig, signupAt: Date): Date {
    return computeDueAt(
      signupAt,
      {
        delayMinutes: delayMinutesForStep(step, cfg),
        businessHoursOnly: cfg.scheduler?.businessHoursOnly ?? false,
      },
      { timezone: client.config.timezone || 'UTC', holidays: client.config.holidays ?? [] },
    );
  }

  /**
   * Run one scan. Fires every scheduler-triggered step that is due, plus any
   * pending step runs whose backoff window has elapsed.
   */
  async runTick(now = this.clock()): Promise<{ fired: number; skipped: number }> {
    const clients = await this.deps.repo.listClients();
    let fired = 0;
    let skipped = 0;

    for (const client of clients) {
      try {
        fired += await this.fireClient(client, now);
      } catch (err) {
        this.logger.warn('scheduler.client_skipped', {
          client: client.slug,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped += 1;
      }
    }
    return { fired, skipped };
  }

  private async fireClient(client: Client, now: Date): Promise<number> {
    let fired = 0;
    const entries = Object.entries(client.config.steps ?? {}) as Array<
      [StepId, StepConfig | undefined]
    >;
    const scheduledSteps: Array<[StepId, StepConfig]> = [];
    for (const [step, cfg] of entries) {
      const resolved = cfg ?? defaultStepConfig(step);
      if (resolved.enabled !== false && resolved.trigger === 'scheduler' && resolved.scheduler?.enabled) {
        scheduledSteps.push([step, resolved]);
      }
    }

    if (scheduledSteps.length > 0) {
      const customers = await this.deps.repo.listCustomers({ clientSlug: client.slug });
      for (const customer of customers) {
        if (customer.failed) continue;
        for (const [step, cfg] of scheduledSteps) {
          if (customer.completedSteps[step]) continue;
          const signupAt = new Date(customer.signupAt);
          const due = this.dueAt(client, step, cfg, signupAt);
          if (due.getTime() <= now.getTime()) {
            await this.engine.runStep(client, customer, step);
            fired += 1;
          }
        }
      }
    }

    // Resume backoff retries whose window has elapsed.
    const pendingRuns = (await this.deps.repo.listStepRuns({ clientSlug: client.slug, status: 'pending' })).filter(
      (r) => r.nextAttemptAt && new Date(r.nextAttemptAt).getTime() <= now.getTime(),
    );
    for (const run of pendingRuns) {
      const customer = await this.deps.repo.getCustomer(run.clientSlug, run.customerEmail);
      if (!customer) continue;
      await this.engine.runStep(client, customer, run.step);
      fired += 1;
    }
    return fired;
  }
}