import type { Client, Customer, Logger, StepId } from './types.js';
import { noopLogger } from './types.js';
import type { EventEnvelope } from './events.js';
import type { Repository } from './repo.js';
import type { ProviderFactory } from './providers.js';
import { defaultStepConfig } from './config.js';
import { addBackoffDelay } from './timing.js';
import { sendFailureAlert, STEPS, type StepContext, type StepResult } from './steps/index.js';

export type EngineOptions = {
  baseUrl?: string;
  logger?: Logger;
  clock?: () => Date;
};

export type StepOutcome = {
  step: StepId;
  status: 'success' | 'skipped' | 'failed' | 'error';
  reason?: string;
  attempts: number;
};

export class StepEngine {
  private ctx: StepContext;
  private clock: () => Date;

  constructor(
    private deps: { repo: Repository; factory: ProviderFactory },
    opts: EngineOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date());
    this.ctx = {
      factory: deps.factory,
      repo: deps.repo,
      logger: opts.logger ?? noopLogger,
      baseUrl: opts.baseUrl,
    };
  }

  get context(): StepContext {
    return this.ctx;
  }

  async getCustomer(client: Client, email: string): Promise<Customer | null> {
    return this.deps.repo.getCustomer(client.slug, email);
  }

  /**
   * Fire an event for the given client. Upserts the customer, then runs the
   * requested steps concurrently (per-step retries included).
   */
  async handleEvent(client: Client, ev: EventEnvelope): Promise<{ customer: Customer; results: StepOutcome[] }> {
    // Use the freshest config in case the caller passes a stale client object.
    const fresh = (await this.deps.repo.getClientBySlug(client.slug)) ?? client;
    const customer = await this.deps.repo.upsertCustomer(ev.clientSlug, ev.customer);
    // A fresh run clears any previous failed flag; runStep re-sets it only if
    // it exhausts retries meanwhile.
    await this.deps.repo.setCustomerFailed(customer.id, false);
    const settled = await Promise.allSettled(
      ev.steps.map(async (step) => {
        try {
          return await this.runStep(fresh, customer, step);
        } catch (err) {
          return {
            step,
            status: 'error' as const,
            reason: err instanceof Error ? err.message : String(err),
            attempts: 0,
          };
        }
      }),
    );
    const results: StepOutcome[] = settled.map((res, i) => {
      const step = ev.steps[i]!;
      if (res.status === 'fulfilled') return res.value;
      return {
        step,
        status: 'error',
        reason: res.reason instanceof Error ? res.reason.message : String(res.reason),
        attempts: 0,
      };
    });
    // Return the post-run customer so callers see completedSteps/failed state.
    const final = (await this.deps.repo.getCustomer(fresh.slug, customer.email)) ?? customer;
    return { customer: final, results };
  }

  /**
   * Run a single step with retry/backoff. Resumes an existing pending/failed
   * run when one exists (used by the scheduler for in-flight retries).
   */
  async runStep(client: Client, customer: Customer, step: StepId): Promise<StepOutcome> {
    const config = client.config.steps?.[step] ?? defaultStepConfig(step);
    if (config.enabled === false) {
      return { step, status: 'skipped', reason: 'disabled in client config', attempts: 0 };
    }

    const lastRun = await this.deps.repo.getLastStepRun(client.slug, customer.email, step);
    if (lastRun?.status === 'success') {
      return { step, status: 'skipped', reason: 'already completed', attempts: lastRun.attempts };
    }

    const maxAttempts = client.config.retry.maxAttempts;
    const baseDelayMs = client.config.retry.baseDelayMs;
    let run;
    if (lastRun) {
      if (lastRun.status === 'failed') {
        // A terminal failure keeps its history; a fresh manual/schedule retry
        // restarts the counter.
        run = await this.deps.repo.updateStepRun(lastRun.id, {
          status: 'pending',
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
        });
      } else {
        run = lastRun; // pending: resume the backoff window
      }
    } else {
      run = await this.deps.repo.createStepRun({ clientSlug: client.slug, customerEmail: customer.email, step });
    }
    const provider = STEPS[step];

    for (let attempt = run.attempts + 1; attempt <= maxAttempts; attempt++) {
      const occurred = this.clock().toISOString();
      try {
        const result: StepResult | void = await provider.run(this.ctx, client, customer);
        // Both a real send and a benign skip complete the step so the scheduler
        // never re-fires it.
        await this.deps.repo.updateCustomerCompletion(customer.id, step, occurred);
        await this.deps.repo.updateStepRun(run.id, { status: 'success', attempts: attempt, runAt: occurred });
        return {
          step,
          status: result?.skipped ? 'skipped' : 'success',
          reason: result?.skipped,
          attempts: attempt,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const canRetry = attempt < maxAttempts;
        const next = canRetry ? addBackoffDelay(this.clock(), attempt, baseDelayMs) : null;
        await this.deps.repo.updateStepRun(run.id, {
          status: canRetry ? 'pending' : 'failed',
          attempts: attempt,
          lastError: message,
          nextAttemptAt: next?.toISOString() ?? null,
        });
        if (!canRetry) {
          await this.deps.repo.setCustomerFailed(customer.id, true);
          await sendFailureAlert(client, customer, step, message, attempt, this.ctx);
        }
      }
    }
    return { step, status: 'failed', reason: 'max attempts reached', attempts: maxAttempts };
  }

  /** Re-run every failed/pending step for a customer (admin "retry" action). */
  async retryCustomer(client: Client, customer: Customer): Promise<StepOutcome[]> {
    const runs = await this.deps.repo.listStepRuns({ clientSlug: client.slug, customerEmail: customer.email });
    const failed = runs.filter((r) => r.status === 'failed' || r.status === 'pending');
    const steps = [...new Set(failed.map((r) => r.step))];
    await this.deps.repo.setCustomerFailed(customer.id, false);
    const outcomes: StepOutcome[] = [];
    for (const step of steps) {
      outcomes.push(await this.runStep(client, customer, step));
    }
    return outcomes;
  }
}