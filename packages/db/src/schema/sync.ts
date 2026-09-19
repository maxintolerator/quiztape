import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, emptyJsonObject, tstz, updatedAt } from './_common';
import { jobStatus, syncJobKind, syncPhase } from './enums';
import { users } from './users';

/**
 * Where a user's history stands. The backfill pins `backfillPinnedTo` to the
 * sync start so page numbers stay stable while new scrobbles arrive, then
 * incremental syncs fetch everything after `newestPlayedAt`.
 */
export const userSyncState = pgTable(
  'user_sync_state',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    phase: syncPhase().notNull().default('pending'),
    backfillPinnedTo: tstz(),
    backfillNextPage: integer(),
    backfillTotalPages: integer(),
    backfillStartedAt: tstz(),
    backfillCompletedAt: tstz(),
    lastIncrementalAt: tstz(),
    oldestPlayedAt: tstz(),
    newestPlayedAt: tstz(),
    scrobbleCount: bigint({ mode: 'number' }).notNull().default(0),
    /** Rollups (user_*_stats) reflect scrobbles up to this instant; null = never built. */
    statsBuiltThrough: tstz(),
    statsBuiltAt: tstz(),
    lastErrorCode: smallint(),
    lastError: text(),
    lastErrorAt: tstz(),
    updatedAt: updatedAt(),
  },
  (t) => [index('user_sync_state_phase_idx').on(t.phase, t.lastIncrementalAt)],
);

/** Durable job queue for backfills, incremental syncs, rollup rebuilds and MusicBrainz/Wikidata ingestion. */
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
);
