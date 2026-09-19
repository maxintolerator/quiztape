import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError, parseRetryAfter } from './http-error';
import { withRetry } from './retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries retryable HTTP errors with capped exponential backoff', async () => {
    let calls = 0;
    const delays: number[] = [];
    const p = withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError(503, 'https://x/');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 100, random: () => 1 - Number.EPSILON, onRetry: (_e, _a, d) => delays.push(d) },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe('ok');
    expect(calls).toBe(3);
    expect(delays).toEqual([99, 199]);
  });

  it('honours Retry-After over the backoff schedule', async () => {
    let calls = 0;
    const delays: number[] = [];
    const p = withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new HttpError(429, 'https://x/', { retryAfterMs: 2500 });
        return calls;
      },
      { baseDelayMs: 100, onRetry: (_e, _a, d) => delays.push(d) },
    );
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toBe(2);
    expect(delays).toEqual([2500]);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(404, 'https://x/');
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);
  });

  it('gives up after the configured number of retries', async () => {
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new HttpError(500, 'https://x/');
      },
      { retries: 2, baseDelayMs: 1, random: () => 0 },
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toBeInstanceOf(HttpError);
    expect(calls).toBe(3);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta seconds', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
  });
  it('parses HTTP dates relative to now', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90_000);
  });
  it('returns undefined for junk', () => {
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});
