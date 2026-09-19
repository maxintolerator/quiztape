import { schema } from '@quiztape/db';
import { and, eq, gt, lt, lte, or, sql } from 'drizzle-orm';

import type { Services } from '../services';
import type { JobKind } from './queue';

export type SyncJob = typeof schema.syncJobs.$inferSelect;

export interface JobContext {
  services: Services;
  job: SyncJob;
  /** Extend the lease and publish progress the client can render. */
  heartbeat: (progress?: Record<string, unknown>) => Promise<void>;
  signal: AbortSignal;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export interface JobRunnerOptions {
  workerId: string;
  pollMs?: number | undefined;
  leaseMs?: number | undefined;
  concurrency?: number | undefined;
  /** Base delay for retry back-off; doubles per attempt, capped at 1 hour. */
  retryBaseMs?: number | undefined;
  onError?: ((error: unknown, job: SyncJob) => void) | undefined;
}

/**
 * Minimal durable job runner on top of `sync_jobs`: claim with
 * FOR UPDATE SKIP LOCKED, lease, run, mark done or re-queue with back-off.
 * Runs inside the API process; several instances may share the table.
 */
export class JobRunner {
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly concurrency: number;
  private readonly retryBaseMs: number;
  private readonly controller = new AbortController();
  private running = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private inFlight = new Set<Promise<void>>();
  private lastTickError: { message: string; at: number; suppressed: number } | null = null;

  constructor(
    private readonly services: Services,
    private readonly handlers: JobHandlers,
    private readonly options: JobRunnerOptions,
  ) {
    this.pollMs = options.pollMs ?? 2_000;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.concurrency = options.concurrency ?? 2;
    this.retryBaseMs = options.retryBaseMs ?? 30_000;
  }

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller.abort();
    await Promise.allSettled([...this.inFlight]);
  }

  /** Claim and run at most one job. Returns the job id when something ran. Used by the loop and by tests. */
  async runOnce(): Promise<number | null> {
    const job = await this.claim();
    if (!job) return null;
    await this.execute(job);
    return job.id;
  }

  /** Drain everything that is runnable right now (tests and one-shot CLI use). */
  async drain(max = 100): Promise<number> {
    let count = 0;
    while (count < max && (await this.runOnce()) !== null) count++;
    return count;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      while (this.running < this.concurrency) {
        const job = await this.claim();
        if (!job) break;
        this.running++;
        const promise = this.execute(job).finally(() => {
          this.running--;
          this.inFlight.delete(promise);
        });
        this.inFlight.add(promise);
      }
    } catch (error) {
      this.reportTickError(error);
    }
    this.timer = setTimeout(() => void this.tick(), this.pollMs);
  }

  /** The same failure (for example an unreachable database) is reported once a minute, not every poll. */
  private reportTickError(error: unknown): void {
    const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
    const at = this.services.now().getTime();
    const last = this.lastTickError;
    if (last && last.message === message && at - last.at < 60_000) {
      last.suppressed++;
      return;
    }
    const suffix = last && last.message === message && last.suppressed > 0 ? ` (repeated ${last.suppressed} more times)` : '';
    console.error(`job runner: ${message}${suffix}`);
    this.lastTickError = { message, at, suppressed: 0 };
  }

  private async claim(): Promise<SyncJob | null> {
    const { db, now } = this.services;
    const current = now();
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: schema.syncJobs.id })
        .from(schema.syncJobs)
        .where(
          or(
            and(eq(schema.syncJobs.status, 'queued'), lte(schema.syncJobs.runAfter, current)),
            and(eq(schema.syncJobs.status, 'running'), lt(schema.syncJobs.leaseExpiresAt, current)),
          ),
        )
        .orderBy(sql`${schema.syncJobs.priority} desc`, schema.syncJobs.runAfter, schema.syncJobs.id)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;
      const [job] = await tx
        .update(schema.syncJobs)
        .set({
          status: 'running',
          lockedBy: this.options.workerId,
          leaseExpiresAt: new Date(current.getTime() + this.leaseMs),
          startedAt: sql`coalesce(${schema.syncJobs.startedAt}, ${current})`,
          attempts: sql`${schema.syncJobs.attempts} + 1`,
          updatedAt: current,
        })
        .where(eq(schema.syncJobs.id, candidate.id))
        .returning();
      return job ?? null;
    });
  }

  private async execute(job: SyncJob): Promise<void> {
    const { db, now } = this.services;
    const handler = this.handlers[job.kind];
    const heartbeat = async (progress?: Record<string, unknown>) => {
      const current = now();
      await db
        .update(schema.syncJobs)
        .set({
          leaseExpiresAt: new Date(current.getTime() + this.leaseMs),
          updatedAt: current,
          ...(progress ? { progress } : {}),
        })
        .where(and(eq(schema.syncJobs.id, job.id), gt(schema.syncJobs.attempts, 0)));
    };

    try {
      if (!handler) throw new Error(`no handler registered for job kind ${job.kind}`);
      await handler({ services: this.services, job, heartbeat, signal: this.controller.signal });
      const current = now();
      await db
        .update(schema.syncJobs)
        .set({ status: 'succeeded', finishedAt: current, leaseExpiresAt: null, lockedBy: null, updatedAt: current })
        .where(eq(schema.syncJobs.id, job.id));
    } catch (error) {
      this.options.onError?.(error, job);
      const current = now();
      const message = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : String(error);
      const exhausted = job.attempts >= job.maxAttempts;
      const delay = Math.min(60 * 60 * 1000, this.retryBaseMs * 2 ** Math.max(0, job.attempts - 1));
      await db
        .update(schema.syncJobs)
        .set({
          status: exhausted ? 'failed' : 'queued',
          runAfter: new Date(current.getTime() + delay),
          leaseExpiresAt: null,
          lockedBy: null,
          lastError: message,
          finishedAt: exhausted ? current : null,
          updatedAt: current,
        })
        .where(eq(schema.syncJobs.id, job.id));
    }
  }
}
