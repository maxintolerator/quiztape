import { serve } from '@hono/node-server';

import { loadDotenv } from './load-env';

loadDotenv();

import { createApp } from './app';
import { loadEnv } from './env';
import { handlers } from './jobs/handlers';
import { JobRunner } from './jobs/runner';
import { assertSchemaReady } from './lib/schema-check';
import { createServices } from './services';

const env = loadEnv();
const services = createServices(env);
const app = createApp(services, { log: env.NODE_ENV !== 'production' });

try {
  await assertSchemaReady(services);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  await services.close();
  process.exit(1);
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`quiztape-api listening on http://localhost:${info.port}`);
});

let runner: JobRunner | undefined;
if (env.WORKER_ENABLED) {
  runner = new JobRunner(services, handlers, { workerId: env.WORKER_ID });
  runner.start();
  console.log(`job runner ${env.WORKER_ID} started`);
}

async function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  await runner?.stop();
  server.close();
  await services.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
