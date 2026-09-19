import { Hono } from 'hono';

import type { AppEnv } from '../app';

export const health = new Hono<AppEnv>().get('/', (c) =>
  c.json({ ok: true, service: 'quiztape-api', version: '0.1.0', time: new Date().toISOString() }),
);
