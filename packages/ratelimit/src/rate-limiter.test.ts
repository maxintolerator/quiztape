import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimiter } from './rate-limiter';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never dispatches faster than requestsPerSecond', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1 });
    const starts: number[] = [];
    const all = Promise.all([1, 2, 3].map((n) => limiter.schedule(async () => starts.push(Date.now()) && n)));
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([0, 1000]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toEqual([0, 1000, 2000]);
    await expect(all).resolves.toEqual([1, 2, 3]);
  });

  it('allows a burst up to the bucket size, then throttles', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 5, burst: 5, concurrency: 10 });
    const starts: number[] = [];
    for (let i = 0; i < 7; i++) void limiter.schedule(async () => starts.push(Date.now()));
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(200);
    expect(starts).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(200);
    expect(starts).toHaveLength(7);
  });

  it('caps in-flight tasks at concurrency even when tokens are available', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 100, burst: 100, concurrency: 1 });
    const first = deferred();
    const starts: string[] = [];
    void limiter.schedule(async () => {
      starts.push('a');
      await first.promise;
    });
    void limiter.schedule(async () => {
      starts.push('b');
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(starts).toEqual(['a']);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual(['a', 'b']);
  });

  it('dispatches higher priority tasks first, FIFO within a priority', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1 });
    const order: string[] = [];
    // First task takes the only token immediately; the rest queue up.
    void limiter.schedule(async () => order.push('first'));
    void limiter.schedule(async () => order.push('bg-1'), { priority: 0 });
    void limiter.schedule(async () => order.push('bg-2'), { priority: 0 });
    void limiter.schedule(async () => order.push('interactive'), { priority: 10 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(order).toEqual(['first', 'interactive', 'bg-1', 'bg-2']);
  });

  it('pause() holds dispatch until the deadline (Retry-After)', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 10, burst: 10 });
    const starts: number[] = [];
    limiter.pause(5000);
    void limiter.schedule(async () => starts.push(Date.now()));
    await vi.advanceTimersByTimeAsync(4999);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([5000]);
  });

  it('rejects and drops a task whose signal aborts while queued', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1 });
    const controller = new AbortController();
    void limiter.schedule(async () => 'first');
    const second = limiter.schedule(async () => 'second', { signal: controller.signal });
    controller.abort(new Error('user left'));
    await expect(second).rejects.toThrow('user left');
    expect(limiter.stats().queued).toBe(0);
  });

  it('rejects immediately when scheduled with an already-aborted signal', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.schedule(async () => 1, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('propagates task failures without stalling the queue', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1000, burst: 10 });
    const failing = limiter.schedule(async () => {
      throw new Error('boom');
    });
    const next = limiter.schedule(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('idle() resolves once everything has drained', async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 2 });
    let done = 0;
    for (let i = 0; i < 3; i++) void limiter.schedule(async () => void done++);
    const idle = limiter.idle();
    await vi.advanceTimersByTimeAsync(2000);
    await idle;
    expect(done).toBe(3);
  });
});
