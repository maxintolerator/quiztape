import { serve } from '@hono/node-server';

import { createApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = createApp({ corsOrigins: env.CORS_ORIGINS, log: env.NODE_ENV !== 'production' });

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`quiztape-api listening on http://localhost:${info.port}`);
});
