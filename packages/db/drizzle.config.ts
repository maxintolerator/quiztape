import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

/**
 * Local runs: read the nearest `.env` walking up from the working directory
 * (drizzle-kit runs with cwd = packages/db, the repo root holds .env).
 * `import.meta.dirname` is not available inside drizzle-kit's bundled config.
 */
function loadNearestDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
loadNearestDotenv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    // Migrations prefer a direct connection (Supabase: port 5432); the API may use the pooler.
    url: process.env['DATABASE_MIGRATE_URL'] || process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/quiztape',
  },
  strict: true,
  verbose: true,
});
