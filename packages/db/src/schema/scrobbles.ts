import { bigint, boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, tstz } from './_common';
import { syncJobs } from './sync';
import { users } from './users';

/**
 * One row per scrobble, exactly as the brief demands. Names are stored inline
 * with normalised `*_key` columns (lower(trim(name))) so backfill is a single
 * INSERT ... ON CONFLICT DO NOTHING and stats are plain GROUP BYs per user.
 * Last.fm MBIDs are kept as hints only; they are not trusted for joins.
 */
export const scrobbles = pgTable(
  'scrobbles',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    playedAt: tstz().notNull(),
    artistName: text().notNull(),
    artistKey: text().notNull(),
    trackName: text().notNull(),
    trackKey: text().notNull(),
    albumName: text(),
    albumKey: text(),
    artistMbidHint: uuid(),
    albumMbidHint: uuid(),
    trackMbidHint: uuid(),
    /** Only known when fetched with extended=1. */
    loved: boolean(),
    syncJobId: bigint({ mode: 'number' }).references(() => syncJobs.id, { onDelete: 'set null' }),
    insertedAt: createdAt(),
  },
  (t) => [
    // Idempotent backfill: Last.fm can return the same play on overlapping pages.
    uniqueIndex('scrobbles_dedupe_uq').on(t.userId, t.playedAt, t.artistKey, t.trackKey),
    // Per-artist history: top track, first play, plays in a window.
    index('scrobbles_user_artist_time_idx').on(t.userId, t.artistKey, t.playedAt),
    // Recent history and year windows.
    index('scrobbles_user_time_idx').on(t.userId, t.playedAt),
  ],
);
