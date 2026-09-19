import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { auth } from './routes/auth';
import { brackets } from './routes/brackets';
import { health } from './routes/health';
import { me } from './routes/me';
import { rounds } from './routes/rounds';
import type { Services } from './services';
import type { AuthContext } from './middleware/require-auth';

export type AppEnv = {
  Variables: {
    services: Services;
    auth: AuthContext | null;
  };
};

export interface AppOptions {
  log?: boolean | undefined;
}

/**
 * The API as a plain Hono app so it can be served by Node locally and by a
 * serverless adapter in production without changing routes.
 */
export function createApp(services: Services, options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  if (options.log) app.use(logger());
  app.use('*', async (c, next) => {
    c.set('services', services);
    c.set('auth', null);
    await next();
  });
  app.use(
    '*',
    cors({
      origin: services.config.corsOrigins,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
    }),
  );

  app.route('/health', health);
  app.route('/v1/auth', auth);
  app.route('/v1/me', me);
  app.route('/v1/rounds', rounds);
  app.route('/v1/brackets', brackets);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
