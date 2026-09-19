import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Db } from './client';
import * as schema from './schema';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * An in-process Postgres (PGlite, WASM) with every checked-in migration
 * applied. Used by schema tests and, later, engine tests, so the real SQL is
 * exercised in CI with nothing installed.
 */
export async function createTestDb() {
  const client = new PGlite();
  const pglite = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(pglite, { migrationsFolder: MIGRATIONS_DIR });
  const db: Db = pglite;
  return { db, pglite, client, close: () => client.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>['pglite'];
