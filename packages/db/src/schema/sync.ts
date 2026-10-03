import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, emptyJsonObject, tstz, updatedAt } from './_common';
import { jobStatus, syncJobKind } from './enums';
import { users } from './users';

/** Durable job queue for MusicBrainz/Wikidata ingestion. */
export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    kind: syncJobKind().notNull(),
    status: jobStatus().notNull().default('queued'),
    /** Higher runs first; interactive requests outrank background backfill. */
    priority: smallint().notNull().default(0),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /** Target MBID for mb_ingest / wd_enrich jobs. */
    mbid: uuid(),
    /** Dedupe key so the same work is never queued twice while pending: e.g. 'backfill:<user>' or 'mb_artist:<mbid>'. */
    dedupeKey: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    /** Free-form progress the client can render: pages fetched, rows inserted, percent. */
    progress: jsonb().$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    attempts: smallint().notNull().default(0),
    maxAttempts: smallint().notNull().default(5),
    runAfter: tstz().notNull().defaultNow(),
    lockedBy: text(),
    leaseExpiresAt: tstz(),
    startedAt: tstz(),
    finishedAt: tstz(),
    lastError: text(),
    lastErrorCode: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sync_jobs_dedupe_pending_uq').on(t.dedupeKey).where(sql`${t.status} in ('queued', 'running')`),
    index('sync_jobs_runnable_idx').on(t.priority, t.runAfter, t.id).where(sql`${t.status} = 'queued'`),
    index('sync_jobs_lease_idx').on(t.leaseExpiresAt).where(sql`${t.status} = 'running'`),
    index('sync_jobs_user_idx').on(t.userId, t.kind, t.createdAt),
  ],
).enableRLS();
