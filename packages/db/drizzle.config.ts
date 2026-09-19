import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

// Local runs: read the repo-root .env so `npm run db:migrate` just works.
const dotenv = resolve(import.meta.dirname, '..', '..', '.env');
if (existsSync(dotenv)) process.loadEnvFile(dotenv);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    // Migrations prefer a direct connection (Supabase: port 5432), the API uses the pooler.
    url: process.env['DATABASE_MIGRATE_URL'] ?? process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/quiztape',
  },
  strict: true,
  verbose: true,
});
