import { schema } from '@quiztape/db';
import type { MusicBrainzClient } from '@quiztape/musicbrainz';
import { and, eq, gt } from 'drizzle-orm';

import type { Services } from '../services';

type EntityType = (typeof schema.mbEntityType.enumValues)[number];

const DAY_MS = 86_400_000;

/**
 * Read-through cache over MusicBrainz lookups. A fresh row in
 * mb_cache_entries answers without a request; a `not_found` row is the
 * negative cache; transport errors are never cached.
 */
export async function cachedEntity<T>(
  services: Services,
  entityType: EntityType,
  mbid: string,
  inc: readonly string[],
  fetcher: () => Promise<T | null>,
  ttlDays = 30,
): Promise<T | null> {
  const { db, now } = services;
  const incKey = [...inc].sort().join(' ');
  const [hit] = await db
    .select()
    .from(schema.mbCacheEntries)
    .where(and(eq(schema.mbCacheEntries.entityType, entityType), eq(schema.mbCacheEntries.mbid, mbid), eq(schema.mbCacheEntries.inc, incKey), gt(schema.mbCacheEntries.expiresAt, now())))
    .limit(1);
  if (hit) return hit.status === 'ok' ? (hit.payload as T) : null;

  const data = await fetcher();
  const current = now();
  await db
    .insert(schema.mbCacheEntries)
    .values({
      entityType,
      mbid,
      inc: incKey,
      status: data === null ? 'not_found' : 'ok',
      httpStatus: data === null ? 404 : 200,
      payload: data === null ? null : (data as Record<string, unknown>),
      fetchedAt: current,
      expiresAt: new Date(current.getTime() + (data === null ? 90 : ttlDays) * DAY_MS),
    })
    .onConflictDoUpdate({
      target: [schema.mbCacheEntries.entityType, schema.mbCacheEntries.mbid, schema.mbCacheEntries.inc],
      set: {
        status: data === null ? 'not_found' : 'ok',
        httpStatus: data === null ? 404 : 200,
        payload: data === null ? null : (data as Record<string, unknown>),
        error: null,
        fetchedAt: current,
        expiresAt: new Date(current.getTime() + (data === null ? 90 : ttlDays) * DAY_MS),
      },
    });
  return data;
}

/** Browse results are cached under the browsed entity with a synthetic inc key such as `browse:release-groups:album`. */
export async function cachedBrowse<T>(services: Services, entityType: EntityType, mbid: string, browseKey: string, fetcher: () => Promise<T>, ttlDays = 30): Promise<T> {
  const result = await cachedEntity<{ items: T }>(services, entityType, mbid, [browseKey], async () => ({ items: await fetcher() }), ttlDays);
  return (result?.items ?? ([] as unknown as T)) as T;
}

export interface SearchOutcome {
  candidates: unknown[];
  topMbid: string | null;
  topScore: number | null;
  topIsUnique: boolean;
}

/** Name searches cached by normalised query with a shorter TTL, since the search index lags edits. */
export async function cachedSearch(services: Services, entityType: EntityType, queryKey: string, query: string, run: () => Promise<SearchOutcome>, ttlDays = 14): Promise<SearchOutcome> {
  const { db, now } = services;
  const [hit] = await db
    .select()
    .from(schema.mbSearchCache)
    .where(and(eq(schema.mbSearchCache.entityType, entityType), eq(schema.mbSearchCache.queryKey, queryKey), gt(schema.mbSearchCache.expiresAt, now())))
    .limit(1);
  if (hit) return { candidates: hit.candidates, topMbid: hit.topMbid, topScore: hit.topScore, topIsUnique: hit.topIsUnique };
  const outcome = await run();
  const current = now();
  const row = {
    query,
    topMbid: outcome.topMbid,
    topScore: outcome.topScore,
    topIsUnique: outcome.topIsUnique,
    candidates: outcome.candidates,
    searchedAt: current,
    expiresAt: new Date(current.getTime() + ttlDays * DAY_MS),
  };
  await db
    .insert(schema.mbSearchCache)
    .values({ entityType, queryKey, ...row })
    .onConflictDoUpdate({ target: [schema.mbSearchCache.entityType, schema.mbSearchCache.queryKey], set: row });
  return outcome;
}

export type Mb = MusicBrainzClient;
