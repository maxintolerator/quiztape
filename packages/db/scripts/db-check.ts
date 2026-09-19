/**
 * Print what the configured database actually contains: connection target,
 * public tables, and which migrations are applied versus checked in.
 * Run: npm run db:check
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const dotenv = resolve(repoRoot, '.env');
if (existsSync(dotenv)) process.loadEnvFile(dotenv);

const url = process.env['DATABASE_MIGRATE_URL'] || process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.');
  process.exit(2);
}
const target = new URL(url);
console.log(`target: ${target.hostname}:${target.port || '5432'}${target.pathname} as ${target.username}`);

const journal = JSON.parse(readFileSync(resolve(here, '..', 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });
let exitCode = 0;
try {
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' order by 1`;
  console.log(`public tables: ${tables.length}${tables.length ? ` (${tables.map((t) => t.tablename).join(', ')})` : ''}`);
  const presentRows = await sql<{ present: string | null }[]>`select to_regclass('drizzle.__drizzle_migrations')::text as present`;
  const present = presentRows[0]?.present ?? null;
  const applied = present ? await sql<{ hash: string; created_at: string }[]>`select hash, created_at from drizzle.__drizzle_migrations order by id` : [];
  console.log(`migrations applied: ${applied.length} of ${journal.entries.length} checked in (${journal.entries.map((e) => e.tag).join(', ')})`);
  if (applied.length < journal.entries.length) {
    console.log('\nSchema is behind. Run: npm run db:migrate');
    exitCode = 1;
  } else {
    console.log('\nSchema is up to date.');
  }
} catch (error) {
  console.error('Could not query the database:', error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(exitCode);
