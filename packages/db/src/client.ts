import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/** Driver-agnostic handle: postgres.js in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface CreateDbOptions {
  /** Connection pool size. Supabase's transaction pooler wants small pools per instance. */
  max?: number | undefined;
  /** Required for Supabase transaction-mode pooling (no prepared statements). */
  prepare?: boolean | undefined;
}

export function createDb(url: string, options: CreateDbOptions = {}) {
  const sql = postgres(url, { max: options.max ?? 5, prepare: options.prepare ?? false });
  const db: Db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
