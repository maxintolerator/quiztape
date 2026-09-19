import { schema } from '@quiztape/db';
import { LastfmApiError, RECENT_TRACKS_MAX_LIMIT, asArray, normalizeRecentTrack } from '@quiztape/lastfm';
import { eq, sql } from 'drizzle-orm';

import { nameKey } from '../lib/users';
import { enqueueJob } from './queue';
import type { JobContext, JobHandler } from './runner';

type ScrobbleInsert = typeof schema.scrobbles.$inferInsert;

/**
 * Full history import. Pins `to` at the moment the backfill started so page
 * numbers stay stable while new scrobbles arrive, checkpoints the next page
 * after every insert, and resumes from the checkpoint after a crash or retry.
 */
export const backfillJob: JobHandler = async (ctx) => {
  const { services, job } = ctx;
  const { db, lastfm, now } = services;
  if (!job.userId) throw new Error('backfill job without userId');
  const user = await loadUser(ctx, job.userId);
  const state = await loadState(ctx, job.userId);

  let pinnedTo = state.backfillPinnedTo;
  let page = state.backfillNextPage ?? 1;
  let totalPages = state.backfillTotalPages ?? null;
  let inserted = 0;

  if (!pinnedTo) {
    pinnedTo = now();
    page = 1;
    await db
      .update(schema.userSyncState)
      .set({ phase: 'backfilling', backfillPinnedTo: pinnedTo, backfillStartedAt: pinnedTo, backfillNextPage: 1, updatedAt: now() })
      .where(eq(schema.userSyncState.userId, job.userId));
  } else if (state.phase !== 'backfilling') {
    await db.update(schema.userSyncState).set({ phase: 'backfilling', updatedAt: now() }).where(eq(schema.userSyncState.userId, job.userId));
  }

  const toUts = Math.floor(pinnedTo.getTime() / 1000);
  for (;;) {
    if (ctx.signal.aborted) throw new Error('aborted');
    let response;
    try {
      response = await lastfm.getRecentTracks(
        { user: user.lastfmUsername, page, limit: RECENT_TRACKS_MAX_LIMIT, to: toUts, extended: true },
        { priority: 0, signal: ctx.signal },
      );
    } catch (error) {
      if (error instanceof LastfmApiError && error.isPrivacyBlocked) {
        await db
          .update(schema.userSyncState)
          .set({ phase: 'privacy_blocked', lastErrorCode: error.code, lastError: error.message, lastErrorAt: now(), updatedAt: now() })
          .where(eq(schema.userSyncState.userId, job.userId));
        return;
      }
      await db
        .update(schema.userSyncState)
        .set({ lastErrorCode: error instanceof LastfmApiError ? error.code : null, lastError: String(error), lastErrorAt: now(), updatedAt: now() })
        .where(eq(schema.userSyncState.userId, job.userId));
      throw error;
    }

    const attr = response.recenttracks['@attr'];
    totalPages = Number(attr.totalPages) || 0;
    const tracks = asArray(response.recenttracks.track);
    inserted += await insertPage(ctx, job.userId, tracks);
    page += 1;

    await db
      .update(schema.userSyncState)
      .set({
        backfillNextPage: page,
        backfillTotalPages: totalPages,
        scrobbleCount: sql`(select count(*) from ${schema.scrobbles} where ${schema.scrobbles.userId} = ${job.userId})`,
        updatedAt: now(),
      })
      .where(eq(schema.userSyncState.userId, job.userId));
    await ctx.heartbeat({ page: page - 1, totalPages, inserted });

    if (page > totalPages || tracks.length === 0) break;
  }

  await finalize(ctx, job.userId, { completedBackfill: true });
};

/** Everything newer than the last known scrobble. Cheap; the client asks for it on launch. */
export const incrementalJob: JobHandler = async (ctx) => {
  const { services, job } = ctx;
  const { db, lastfm, now } = services;
  if (!job.userId) throw new Error('incremental job without userId');
  const user = await loadUser(ctx, job.userId);
  const state = await loadState(ctx, job.userId);
  if (state.phase !== 'complete' && state.phase !== 'error') {
    await enqueueJob(services, { kind: 'backfill', userId: job.userId, dedupeKey: `backfill:${job.userId}`, priority: 5 });
    return;
  }
  const fromUts = state.newestPlayedAt ? Math.floor(state.newestPlayedAt.getTime() / 1000) : undefined;
  const toUts = Math.floor(now().getTime() / 1000);
  let page = 1;
  let inserted = 0;
  for (;;) {
    const response = await lastfm.getRecentTracks(
      { user: user.lastfmUsername, page, limit: RECENT_TRACKS_MAX_LIMIT, from: fromUts, to: toUts, extended: true },
      { priority: 3, signal: ctx.signal },
    );
    const tracks = asArray(response.recenttracks.track);
    inserted += await insertPage(ctx, job.userId, tracks);
    const totalPages = Number(response.recenttracks['@attr'].totalPages) || 0;
    await ctx.heartbeat({ page, totalPages, inserted });
    page += 1;
    if (page > totalPages || tracks.length === 0) break;
  }
  await finalize(ctx, job.userId, { completedBackfill: false });
};

async function insertPage(ctx: JobContext, userId: string, tracks: Parameters<typeof normalizeRecentTrack>[0][]): Promise<number> {
  const rows: ScrobbleInsert[] = [];
  for (const track of tracks) {
    const normalized = normalizeRecentTrack(track);
    if (!normalized) continue; // now playing
    rows.push({
      userId,
      playedAt: new Date(normalized.playedAtUts * 1000),
      artistName: normalized.artistName,
      artistKey: nameKey(normalized.artistName),
      trackName: normalized.trackName,
      trackKey: nameKey(normalized.trackName),
      albumName: normalized.albumName,
      albumKey: normalized.albumName ? nameKey(normalized.albumName) : null,
      artistMbidHint: normalized.artistMbid,
      albumMbidHint: normalized.albumMbid,
      trackMbidHint: normalized.trackMbid,
      loved: normalized.loved,
      syncJobId: ctx.job.id,
    });
  }
  if (rows.length === 0) return 0;
  const result = await ctx.services.db.insert(schema.scrobbles).values(rows).onConflictDoNothing().returning({ id: schema.scrobbles.id });
  return result.length;
}

async function finalize(ctx: JobContext, userId: string, options: { completedBackfill: boolean }): Promise<void> {
  const { db, now } = ctx.services;
  const [bounds] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${schema.scrobbles.playedAt})`,
      newest: sql<Date | null>`max(${schema.scrobbles.playedAt})`,
    })
    .from(schema.scrobbles)
    .where(eq(schema.scrobbles.userId, userId));
  const current = now();
  await db
    .update(schema.userSyncState)
    .set({
      phase: 'complete',
      scrobbleCount: bounds?.count ?? 0,
      oldestPlayedAt: toDate(bounds?.oldest),
      newestPlayedAt: toDate(bounds?.newest),
      lastIncrementalAt: current,
      lastError: null,
      lastErrorCode: null,
      ...(options.completedBackfill ? { backfillCompletedAt: current } : {}),
      updatedAt: current,
    })
    .where(eq(schema.userSyncState.userId, userId));
  await enqueueJob(ctx.services, { kind: 'stats_rebuild', userId, dedupeKey: `stats_rebuild:${userId}`, priority: 7 });
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

async function loadUser(ctx: JobContext, userId: string) {
  const [user] = await ctx.services.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new Error(`user ${userId} not found`);
  return user;
}

async function loadState(ctx: JobContext, userId: string) {
  const { db } = ctx.services;
  await db.insert(schema.userSyncState).values({ userId }).onConflictDoNothing();
  const [state] = await db.select().from(schema.userSyncState).where(eq(schema.userSyncState.userId, userId)).limit(1);
  if (!state) throw new Error(`sync state for ${userId} missing`);
  return state;
}
