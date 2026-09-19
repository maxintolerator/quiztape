/**
 * Injectable clock so the limiter and retry helpers are deterministic in tests
 * (vitest fake timers) and never depend on wall-clock time directly.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function sleep(ms: number, clock: Clock = systemClock): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}
