import { schema } from '@quiztape/db';
import { MIN_TRIVIA_ARTISTS_FOR_ROUND, type PublicUser, type TriviaSummary } from '@quiztape/shared';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import type { Services } from '../services';

export { nameKey } from '@quiztape/shared';

export function publicUser(user: typeof schema.users.$inferSelect): PublicUser {
  return { id: user.id, lastfmUsername: user.lastfmUsername, lastfmUrl: user.lastfmUrl, realName: user.realName };
}

/** Make sure the per-user singleton rows exist. */
export async function ensureUserRows(services: Services, userId: string): Promise<void> {
  await services.db.insert(schema.userSettings).values({ userId }).onConflictDoNothing();
}

/**
 * How many of these artists have MusicBrainz facts behind them. The keys come
 * from the player's device (the server keeps no library), so the summary is
 * always about whatever artists the caller names.
 */
export async function triviaSummary(services: Services, userId: string, artistKeys: string[]): Promise<TriviaSummary> {
  const { db } = services;
  const keys = [...new Set(artistKeys)];
  if (keys.length === 0) return { eligibleArtists: 0, resolvedArtists: 0, readyArtists: 0, ready: false, running: false };
  const [counts] = await db
    .select({
      resolved: sql<number>`count(${schema.artistResolutions.mbid})::int`,
      ready: sql<number>`count(${schema.mbArtists.discographyFetchedAt})::int`,
    })
    .from(schema.artistResolutions)
    .leftJoin(schema.mbArtists, and(eq(schema.mbArtists.mbid, schema.artistResolutions.mbid), isNotNull(schema.mbArtists.tracklistsFetchedAt)))
    .where(and(inArray(schema.artistResolutions.artistKey, keys), eq(schema.artistResolutions.status, 'resolved')));
  // Running = the user's own fan-out job, or any pending artist job for one of these artists.
  const [running] = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(
      and(
        eq(schema.syncJobs.kind, 'mb_ingest'),
        inArray(schema.syncJobs.status, ['queued', 'running']),
        or(eq(schema.syncJobs.userId, userId), inArray(sql`${schema.syncJobs.payload}->>'artistKey'`, keys)),
      ),
    )
    .limit(1);
  const readyArtists = counts?.ready ?? 0;
  return {
    eligibleArtists: keys.length,
    resolvedArtists: counts?.resolved ?? 0,
    readyArtists,
    ready: readyArtists >= MIN_TRIVIA_ARTISTS_FOR_ROUND,
    running: !!running,
  };
}
