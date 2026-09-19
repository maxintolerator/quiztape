import { schema } from '@quiztape/db';
import type { PublicUser, SyncSummary } from '@quiztape/shared';
import { eq } from 'drizzle-orm';

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

export async function syncSummary(services: Services, userId: string): Promise<SyncSummary> {
  const { db } = services;
  const [state] = await db.select().from(schema.userSyncState).where(eq(schema.userSyncState.userId, userId)).limit(1);
  if (!state) {
    return {
      phase: 'pending',
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
