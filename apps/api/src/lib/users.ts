import { schema } from '@quiztape/db';
import { MIN_PLAYS_FOR_QUESTIONS, MIN_TRIVIA_ARTISTS_FOR_ROUND, type PublicUser, type SyncSummary, type TriviaSummary } from '@quiztape/shared';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import type { Services } from '../services';

export function publicUser(user: typeof schema.users.$inferSelect): PublicUser {
  return { id: user.id, lastfmUsername: user.lastfmUsername, lastfmUrl: user.lastfmUrl, realName: user.realName };
}

/** Normalise a Last.fm name/title for keys: case-insensitive, whitespace-collapsed. */
export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Make sure the per-user singleton rows exist. */
export async function ensureUserRows(services: Services, userId: string): Promise<void> {
  const { db } = services;
  await db.insert(schema.userSettings).values({ userId }).onConflictDoNothing();
  await db.insert(schema.userSyncState).values({ userId }).onConflictDoNothing();
}

/** How much of the user's eligible library has MusicBrainz facts behind it. */
export async function triviaSummary(services: Services, userId: string): Promise<TriviaSummary> {
  const { db } = services;
  const [counts] = await db
    .select({
      eligible: sql<number>`count(*)::int`,
      resolved: sql<number>`count(${schema.artistResolutions.mbid})::int`,
      ready: sql<number>`count(${schema.mbArtists.discographyFetchedAt})::int`,
    })
    .from(schema.userArtistStats)
    .leftJoin(schema.artistResolutions, and(eq(schema.artistResolutions.artistKey, schema.userArtistStats.artistKey), eq(schema.artistResolutions.status, 'resolved')))
    .leftJoin(schema.mbArtists, and(eq(schema.mbArtists.mbid, schema.artistResolutions.mbid), isNotNull(schema.mbArtists.tracklistsFetchedAt)))
    .where(and(eq(schema.userArtistStats.userId, userId), gte(schema.userArtistStats.playCount, MIN_PLAYS_FOR_QUESTIONS)));
  const [running] = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.userId, userId), eq(schema.syncJobs.kind, 'mb_ingest'), inArray(schema.syncJobs.status, ['queued', 'running'])))
    .limit(1);
  const readyArtists = counts?.ready ?? 0;
  return {
    eligibleArtists: counts?.eligible ?? 0,
    resolvedArtists: counts?.resolved ?? 0,
    readyArtists,
    ready: readyArtists >= MIN_TRIVIA_ARTISTS_FOR_ROUND,
    running: !!running,
  };
}

export async function syncSummary(services: Services, userId: string): Promise<SyncSummary> {
  const { db } = services;
  const [state] = await db.select().from(schema.userSyncState).where(eq(schema.userSyncState.userId, userId)).limit(1);
  const trivia = await triviaSummary(services, userId);
  if (!state) {
    return {
      phase: 'pending',
      trivia,
      scrobbleCount: 0,
      percent: null,
      pagesDone: null,
      pagesTotal: null,
      oldestPlayedAt: null,
      newestPlayedAt: null,
      statsBuiltAt: null,
      lastError: null,
    };
  }
  const pagesTotal = state.backfillTotalPages;
  const pagesDone = state.backfillNextPage === null ? null : Math.max(0, state.backfillNextPage - 1);
  let percent: number | null = null;
  if (state.phase === 'complete') percent = 100;
  else if (pagesTotal && pagesDone !== null) percent = Math.min(99, Math.round((pagesDone / pagesTotal) * 100));
  return {
    phase: state.phase,
    trivia,
    scrobbleCount: state.scrobbleCount,
    percent,
    pagesDone,
    pagesTotal,
    oldestPlayedAt: state.oldestPlayedAt?.toISOString() ?? null,
    newestPlayedAt: state.newestPlayedAt?.toISOString() ?? null,
    statsBuiltAt: state.statsBuiltAt?.toISOString() ?? null,
    lastError: state.lastError,
  };
}
