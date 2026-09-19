import { type Clock, sleep, systemClock } from './clock';
import { HttpError } from './http-error';

export interface RetryOptions {
  /** Number of retries after the first attempt. Default 3. */
  retries?: number | undefined;
  /** Base for exponential backoff. Default 500 ms. */
  baseDelayMs?: number | undefined;
  /** Upper bound on any single delay. Default 30 s. */
  maxDelayMs?: number | undefined;
  /** Decide whether an error is worth retrying. Default: HttpError.isRetryable or a network-level TypeError. */
  shouldRetry?: ((error: unknown, attempt: number) => boolean) | undefined;
  /** Extract an upstream-mandated delay (Retry-After). Default reads HttpError.retryAfterMs. */
  retryAfterMs?: ((error: unknown) => number | undefined) | undefined;
  /** Observe each retry; wire this to the limiter's pause() so siblings back off too. */
  onRetry?: ((error: unknown, attempt: number, delayMs: number) => void) | undefined;
  /** Uniform random in [0, 1) for jitter. Injectable for tests. */
  random?: (() => number) | undefined;
  clock?: Clock | undefined;
}

export function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof HttpError) return error.isRetryable;
  // undici/fetch surfaces DNS, reset and timeout failures as TypeError('fetch failed').
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === 'AbortError') return false;
  return false;
}

/**
 * Run `fn` with exponential backoff and full jitter. When the error carries a
 * Retry-After hint, that delay is used verbatim instead of the backoff.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 30_000;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const retryAfterMs = options.retryAfterMs ?? ((error) => (error instanceof HttpError ? error.retryAfterMs : undefined));
  const random = options.random ?? Math.random;
  const clock = options.clock ?? systemClock;

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const hinted = retryAfterMs(error);
      const backoff = Math.min(max, base * 2 ** attempt);
      const delay = hinted !== undefined ? Math.min(max, hinted) : Math.floor(random() * backoff);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay, clock);
      attempt++;
    }
  }
}
