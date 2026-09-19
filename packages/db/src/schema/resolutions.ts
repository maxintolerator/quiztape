import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, numeric, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';

import { emptyJsonArray, tstz, updatedAt } from './_common';
import { resolutionMethod, resolutionStatus } from './enums';

/**
 * Global Last.fm artist name -> MusicBrainz artist mapping, resolved once for
 * all users. The Last.fm MBID is a hint verified by lookup; otherwise a name
 * search with disambiguation. `isManual` overrides survive re-resolution.
 */
export const artistResolutions = pgTable(
  'artist_resolutions',
  {
    artistKey: text().primaryKey(),
    displayName: text().notNull(),
    mbid: uuid(),
    status: resolutionStatus().notNull().default('pending'),
    method: resolutionMethod(),
    /** 0..1; search score / 100 or 1.0 for a verified hint. */
    confidence: numeric({ precision: 4, scale: 3 }),
    /** Top search hits kept for review and for re-resolution without another request. */
    candidates: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    lastfmMbidHint: uuid(),
    isManual: boolean().notNull().default(false),
    manualNote: text(),
    attempts: smallint().notNull().default(0),
    nextAttemptAt: tstz(),
    resolvedAt: tstz(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('artist_resolutions_mbid_idx').on(t.mbid).where(sql`${t.mbid} is not null`),
    index('artist_resolutions_retry_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);
