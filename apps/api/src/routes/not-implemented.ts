import type { Context } from 'hono';

/** Placeholder for endpoints that land in a later build step. */
export function notImplemented(step: number, what: string) {
  return (c: Context) => c.json({ error: 'not_implemented', step, what }, 501);
}
