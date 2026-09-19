import { type Clock, systemClock } from './clock';

export interface RateLimiterOptions {
  /** Human name for diagnostics, e.g. "musicbrainz". */
  name?: string | undefined;
  /** Sustained dispatch rate. MusicBrainz: 1. Last.fm: 5. */
  requestsPerSecond: number;
  /** Bucket capacity: how many tasks may start back-to-back after idle. Default 1 (no burst). */
  burst?: number | undefined;
  /** Maximum tasks in flight at once, independent of the rate. Default 1. */
  concurrency?: number | undefined;
  clock?: Clock | undefined;
}

export interface ScheduleOptions {
  /** Higher runs first. Interactive lookups should outrank background backfill. Default 0. */
  priority?: number | undefined;
  /** Aborting before dispatch rejects with an AbortError and drops the task from the queue. */
  signal?: AbortSignal | undefined;
}

export interface RateLimiterStats {
  name: string;
  queued: number;
  inFlight: number;
  tokens: number;
  pausedForMs: number;
  dispatched: number;
}

interface QueuedTask {
  seq: number;
  priority: number;
  run: () => void;
  abort: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/**
 * Token-bucket rate limiter with a priority FIFO queue.
 *
 * - `requestsPerSecond` refills the bucket continuously; `burst` caps it.
 * - `concurrency` caps in-flight tasks regardless of tokens.
 * - `pause(ms)` holds all dispatch (used to honour Retry-After / 503s).
 * - Tasks with equal priority dispatch in submission order.
 *
 * The limiter never drops work; it only delays it. Callers that need a cap on
 * queue depth should check `stats().queued` before scheduling.
 */
export class RateLimiter {
  readonly name: string;
  private readonly rps: number;
  private readonly burst: number;
  private readonly concurrency: number;
  private readonly clock: Clock;

  private tokens: number;
  private lastRefill: number;
  private pausedUntil = 0;
  private inFlight = 0;
  private dispatched = 0;
  private seq = 0;
  private timer: unknown = null;
  private readonly queue: QueuedTask[] = [];
  private readonly idleWaiters: Array<() => void> = [];

  constructor(options: RateLimiterOptions) {
    if (!(options.requestsPerSecond > 0)) throw new RangeError('requestsPerSecond must be > 0');
    this.name = options.name ?? 'ratelimiter';
    this.rps = options.requestsPerSecond;
    this.burst = Math.max(1, options.burst ?? 1);
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.clock = options.clock ?? systemClock;
    this.tokens = this.burst;
    this.lastRefill = this.clock.now();
  }

  /** Queue `task` and resolve with its result once it has run under the limit. */
  schedule<T>(task: () => Promise<T> | T, options: ScheduleOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError(options.signal.reason));
        return;
      }
      const queued: QueuedTask = {
        seq: this.seq++,
        priority: options.priority ?? 0,
        signal: options.signal,
        onAbort: undefined,
        abort: (reason) => reject(abortError(reason)),
        run: () => {
          this.inFlight++;
          this.dispatched++;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              this.inFlight--;
              this.pump();
            });
        },
      };
      if (options.signal) {
        const signal = options.signal;
        queued.onAbort = () => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) {
            this.queue.splice(index, 1);
            queued.abort(signal.reason);
            this.notifyIfIdle();
          }
        };
        signal.addEventListener('abort', queued.onAbort, { once: true });
      }
      this.insert(queued);
      this.pump();
    });
  }

  /** Hold all dispatch for `ms` from now (e.g. upstream sent Retry-After). Extends but never shortens an existing pause. */
  pause(ms: number): void {
    const until = this.clock.now() + Math.max(0, ms);
    if (until > this.pausedUntil) this.pausedUntil = until;
    this.rearm();
  }

  stats(): RateLimiterStats {
    this.refill();
    return {
      name: this.name,
      queued: this.queue.length,
      inFlight: this.inFlight,
      tokens: this.tokens,
      pausedForMs: Math.max(0, this.pausedUntil - this.clock.now()),
      dispatched: this.dispatched,
    };
  }

  /** Resolves once the queue is empty and nothing is in flight. */
  idle(): Promise<void> {
    if (this.queue.length === 0 && this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private insert(task: QueuedTask): void {
    // Priority-descending, then seq-ascending. Queue stays small; linear insert is fine.
    let i = this.queue.length;
    while (i > 0) {
      const prev = this.queue[i - 1]!;
      if (prev.priority >= task.priority) break;
      i--;
    }
    this.queue.splice(i, 0, task);
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = Math.max(0, now - this.lastRefill);
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.rps);
      this.lastRefill = now;
    }
  }

  private pump(): void {
    this.refill();
    const now = this.clock.now();
    while (
      this.queue.length > 0 &&
      this.inFlight < this.concurrency &&
      this.tokens >= 1 &&
      now >= this.pausedUntil
    ) {
      const next = this.queue.shift()!;
      if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
      this.tokens -= 1;
      next.run();
    }
    this.rearm();
    this.notifyIfIdle();
  }

  /** Arm (or re-arm) the wake-up timer for the next moment dispatch could progress. */
  private rearm(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    if (this.inFlight >= this.concurrency) return; // a finishing task will pump()
    const now = this.clock.now();
    const untilPause = Math.max(0, this.pausedUntil - now);
    const untilToken = this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.rps) * 1000);
    const wait = Math.max(untilPause, untilToken, 1);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait);
  }

  private notifyIfIdle(): void {
    if (this.queue.length === 0 && this.inFlight === 0 && this.idleWaiters.length > 0) {
      const waiters = this.idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted');
  error.name = 'AbortError';
  return error;
}
