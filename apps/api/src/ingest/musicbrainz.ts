import { schema } from '@quiztape/db';
import {
  ARTIST_RELATION_TYPE_ID,
  type Artist,
  type Relation,
  type Release,
  type ReleaseGroup,
  SPECIAL_PURPOSE_ARTIST_MBIDS,
  wikidataQidFromRelations,
} from '@quiztape/musicbrainz';
import { and, eq, or } from 'drizzle-orm';

import { normalizeText } from '../engine/normalize';
import { nameKey } from '../lib/users';
import type { Services } from '../services';
import { cachedBrowse, cachedEntity, cachedSearch } from './cache';
import { isCompleteDate, pickCanonicalRelease, totalTracks, yearOf } from './canonical';

const DAY_MS = 86_400_000;
const ARTIST_INC = ['aliases', 'url-rels', 'artist-rels', 'tags'] as const;
const RELEASE_INC = ['recordings', 'media', 'artist-credits'] as const;
const RETRY_NOT_FOUND_DAYS = 30;
/** Members whose other bands we fetch per group; bounds requests at 1 req/s. */
const MAX_MEMBERS_PER_GROUP = 8;
/** Studio albums whose tracklists we fetch per artist, oldest first. */
const MAX_TRACKLISTS_PER_ARTIST = 16;

// ---------------------------------------------------------------- resolution

export interface ResolveInput {
  artistKey: string;
  displayName: string;
  lastfmMbidHint: string | null;
}

/**
 * Map a Last.fm artist name to a MusicBrainz artist. The Last.fm MBID is a
 * hint verified by lookup; otherwise a name search with disambiguation.
 * Results (including not-found and ambiguous) are stored so the same name
 * is never resolved twice across users.
 */
export async function resolveArtist(services: Services, input: ResolveInput): Promise<string | null> {
  const { db, musicbrainz, now } = services;
  const [existing] = await db.select().from(schema.artistResolutions).where(eq(schema.artistResolutions.artistKey, input.artistKey)).limit(1);
  if (existing) {
    if (existing.isManual) return existing.mbid;
    if (existing.status === 'resolved') return existing.mbid;
    if (existing.status === 'special_purpose') return null;
    if (existing.nextAttemptAt && existing.nextAttemptAt.getTime() > now().getTime()) return null;
  }

  const wanted = normalizeText(input.displayName);
  const save = async (fields: Partial<typeof schema.artistResolutions.$inferInsert>) => {
    const current = now();
    const row = {
      artistKey: input.artistKey,
      displayName: input.displayName,
      lastfmMbidHint: input.lastfmMbidHint,
      attempts: (existing?.attempts ?? 0) + 1,
      updatedAt: current,
      ...fields,
    };
    await db
      .insert(schema.artistResolutions)
      .values(row)
      .onConflictDoUpdate({ target: schema.artistResolutions.artistKey, set: row });
  };

  // 1. The Last.fm hint, verified by lookup and name.
  if (input.lastfmMbidHint) {
    const artist = await cachedEntity<Artist>(services, 'artist', input.lastfmMbidHint, ['aliases'], () => musicbrainz.lookupArtist(input.lastfmMbidHint!, ['aliases'], { priority: 1 }));
    if (artist && artistMatchesName(artist, wanted)) {
      if (SPECIAL_PURPOSE_ARTIST_MBIDS.has(artist.id)) {
        await save({ mbid: artist.id, status: 'special_purpose', method: 'lastfm_hint', confidence: '1.000', resolvedAt: now() });
        return null;
      }
      await save({ mbid: artist.id, status: 'resolved', method: 'lastfm_hint', confidence: '1.000', resolvedAt: now(), nextAttemptAt: null });
      return artist.id;
    }
  }

  // 2. Name search with disambiguation.
  const queryKey = wanted;
  const outcome = await cachedSearch(services, 'artist', queryKey, input.displayName, async () => {
    const result = await musicbrainz.searchArtistsByName(input.displayName, { limit: 8, priority: 1 });
    const candidates = result.artists.map((a) => ({
      id: a.id,
      name: a.name,
      score: a.score ?? 0,
      type: a.type,
      country: a.country,
      disambiguation: a.disambiguation,
      exact: artistMatchesName(a, wanted),
    }));
    const exact = candidates.filter((c) => c.exact).sort((a, b) => b.score - a.score);
    const top = exact[0] ?? candidates[0] ?? null;
    const runnerUp = exact[1] ?? null;
    const unique = !!top && top.exact && (exact.length === 1 || (runnerUp !== null && top.score - runnerUp.score >= 15));
    return { candidates, topMbid: top?.id ?? null, topScore: top?.score ?? null, topIsUnique: unique };
  });

  const candidates = outcome.candidates as { id: string; name: string; score: number; exact: boolean }[];
  const top = candidates.find((c) => c.id === outcome.topMbid) ?? null;
  const retryAt = new Date(now().getTime() + RETRY_NOT_FOUND_DAYS * DAY_MS);

  if (top && top.exact && outcome.topIsUnique && top.score >= 80) {
    if (SPECIAL_PURPOSE_ARTIST_MBIDS.has(top.id)) {
      await save({ mbid: top.id, status: 'special_purpose', method: 'search_exact', confidence: (top.score / 100).toFixed(3), resolvedAt: now() });
      return null;
    }
    await save({ mbid: top.id, status: 'resolved', method: 'search_exact', confidence: (top.score / 100).toFixed(3), candidates, resolvedAt: now(), nextAttemptAt: null });
    return top.id;
  }
  if (top && top.exact && !outcome.topIsUnique) {
    await save({ mbid: null, status: 'ambiguous', method: 'search_exact', confidence: (top.score / 100).toFixed(3), candidates, nextAttemptAt: retryAt });
    return null;
  }
  if (top && !top.exact && top.score >= 97) {
    // Only diacritics or punctuation differ; MusicBrainz is confident.
    await save({ mbid: top.id, status: 'resolved', method: 'search_fuzzy', confidence: (top.score / 100).toFixed(3), candidates, resolvedAt: now(), nextAttemptAt: null });
    return top.id;
  }
  await save({ mbid: null, status: 'not_found', method: 'search_fuzzy', confidence: top ? (top.score / 100).toFixed(3) : null, candidates, nextAttemptAt: retryAt });
  return null;
}

function artistMatchesName(artist: Pick<Artist, 'name' | 'aliases' | 'sort-name'>, wanted: string): boolean {
  if (normalizeText(artist.name) === wanted) return true;
  if (artist['sort-name'] && normalizeText(artist['sort-name']) === wanted) return true;
  return (artist.aliases ?? []).some((alias) => normalizeText(alias.name) === wanted);
}

// ------------------------------------------------------------------- artists

/**
 * Fetch and store one artist with aliases, tags, Wikidata id and artist
 * relationships (canonical orientation, one row per stint). Returns the
 * stored row, or null when the MBID is unknown.
 */
export async function ingestArtist(services: Services, mbid: string, options: { force?: boolean } = {}): Promise<typeof schema.mbArtists.$inferSelect | null> {
  const { db, musicbrainz, now } = services;
  const [existing] = await db.select().from(schema.mbArtists).where(eq(schema.mbArtists.mbid, mbid)).limit(1);
  if (existing && !options.force && existing.relsFetchedAt && existing.expiresAt && existing.expiresAt.getTime() > now().getTime()) return existing;

  const artist = await cachedEntity<Artist>(services, 'artist', mbid, ARTIST_INC, () => musicbrainz.lookupArtist(mbid, [...ARTIST_INC], { priority: 0 }));
  const current = now();
  if (!artist) {
    await db
      .insert(schema.mbArtists)
      .values({ mbid, name: '', nameKey: '', fetchStatus: 'not_found', fetchedAt: current, expiresAt: new Date(current.getTime() + 90 * DAY_MS) })
      .onConflictDoUpdate({ target: schema.mbArtists.mbid, set: { fetchStatus: 'not_found', fetchedAt: current, updatedAt: current } });
    return null;
  }
  if (artist.id !== mbid) {
    await db.insert(schema.mbMbidRedirects).values({ oldMbid: mbid, entityType: 'artist', canonicalMbid: artist.id }).onConflictDoNothing();
  }
  const canonical = artist.id;
  const row = {
    mbid: canonical,
    name: artist.name,
    sortName: artist['sort-name'] ?? null,
    nameKey: nameKey(artist.name),
    type: artist.type ?? null,
    gender: artist.gender ?? null,
    country: artist.country ?? null,
    areaName: artist.area?.name ?? null,
    beginAreaName: artist['begin-area']?.name ?? null,
    lifeBegin: artist['life-span']?.begin ?? null,
    lifeEnd: artist['life-span']?.end ?? null,
    lifeEnded: artist['life-span']?.ended ?? false,
    beginYear: yearOf(artist['life-span']?.begin),
    endYear: yearOf(artist['life-span']?.end),
    disambiguation: artist.disambiguation ?? '',
    aliases: (artist.aliases ?? []).map((a) => ({ name: a.name, type: a.type, locale: a.locale, primary: a.primary })),
    tags: (artist.tags ?? []).slice(0, 20).map((t) => ({ name: t.name, count: t.count })),
    isSpecialPurpose: SPECIAL_PURPOSE_ARTIST_MBIDS.has(canonical),
    wikidataQid: wikidataQidFromRelations(artist.relations),
    fetchStatus: 'ok' as const,
    fetchedAt: current,
    expiresAt: new Date(current.getTime() + 30 * DAY_MS),
    relsFetchedAt: current,
    updatedAt: current,
  };
  await db.insert(schema.mbArtists).values(row).onConflictDoUpdate({ target: schema.mbArtists.mbid, set: row });
  await storeArtistRelations(services, canonical, artist.name, artist.relations ?? []);
  const [stored] = await db.select().from(schema.mbArtists).where(eq(schema.mbArtists.mbid, canonical)).limit(1);
  return stored ?? null;
}

/**
 * Artist-artist relationships in canonical orientation. `direction` is
 * relative to the looked-up artist: 'forward' means it is entity0. Rows that
 * differ only by instrument are merged into one stint with unioned attributes.
 */
async function storeArtistRelations(services: Services, selfMbid: string, selfName: string, relations: Relation[]): Promise<void> {
  const { db, now } = services;
  type Stint = { entity0Mbid: string; entity0Name: string; entity1Mbid: string; entity1Name: string; typeId: string; typeName: string; beginDate: string | null; endDate: string | null; ended: boolean; attributes: Set<string>; attributeValues: Record<string, string>; sourceCredit: string | null; targetCredit: string | null };
  const merged = new Map<string, Stint>();
  for (const relation of relations) {
    if (relation['target-type'] !== 'artist' || !relation.artist) continue;
    const other = relation.artist;
    const forward = relation.direction === 'forward';
    const entity0 = forward ? { mbid: selfMbid, name: selfName } : { mbid: other.id, name: other.name };
    const entity1 = forward ? { mbid: other.id, name: other.name } : { mbid: selfMbid, name: selfName };
    const key = [entity0.mbid, entity1.mbid, relation['type-id'], relation.begin ?? '', relation.end ?? ''].join('|');
    const stint = merged.get(key) ?? {
      entity0Mbid: entity0.mbid,
      entity0Name: entity0.name,
      entity1Mbid: entity1.mbid,
      entity1Name: entity1.name,
      typeId: relation['type-id'],
      typeName: relation.type,
      beginDate: relation.begin ?? null,
      endDate: relation.end ?? null,
      ended: relation.ended ?? false,
      attributes: new Set<string>(),
      attributeValues: {},
      sourceCredit: relation['source-credit'] ?? null,
      targetCredit: relation['target-credit'] ?? null,
    };
    for (const attribute of relation.attributes ?? []) stint.attributes.add(attribute);
    Object.assign(stint.attributeValues, relation['attribute-values'] ?? {});
    merged.set(key, stint);
  }

  const existing = await db
    .select()
    .from(schema.mbArtistRelations)
    .where(or(eq(schema.mbArtistRelations.entity0Mbid, selfMbid), eq(schema.mbArtistRelations.entity1Mbid, selfMbid)));
  const existingByKey = new Map(existing.map((row) => [[row.entity0Mbid, row.entity1Mbid, row.typeId, row.beginDate ?? '', row.endDate ?? ''].join('|'), row]));
  const current = now();
  for (const [key, stint] of merged) {
    const attributes = [...stint.attributes].sort();
    const values = {
      entity0Name: stint.entity0Name,
      entity1Name: stint.entity1Name,
      typeName: stint.typeName,
      ended: stint.ended,
      beginYear: yearOf(stint.beginDate),
      endYear: yearOf(stint.endDate),
      attributes,
      attributeValues: stint.attributeValues,
      isOriginal: stint.attributes.has('original'),
      sourceCredit: stint.sourceCredit,
      targetCredit: stint.targetCredit,
      fetchedAt: current,
    };
    const found = existingByKey.get(key);
    if (found) {
      const union = [...new Set([...found.attributes, ...attributes])].sort();
      await db.update(schema.mbArtistRelations).set({ ...values, attributes: union, isOriginal: values.isOriginal || found.isOriginal }).where(eq(schema.mbArtistRelations.id, found.id));
    } else {
      await db.insert(schema.mbArtistRelations).values({ entity0Mbid: stint.entity0Mbid, entity1Mbid: stint.entity1Mbid, typeId: stint.typeId, beginDate: stint.beginDate, endDate: stint.endDate, ...values });
    }
  }
}

/** For a group: fetch each member's own relationships so side projects and shared members are known. */
export async function ingestMembers(services: Services, group: typeof schema.mbArtists.$inferSelect, signal?: AbortSignal): Promise<number> {
  const members = await services.db
    .select({ mbid: schema.mbArtistRelations.entity0Mbid })
    .from(schema.mbArtistRelations)
    .where(and(eq(schema.mbArtistRelations.entity1Mbid, group.mbid), eq(schema.mbArtistRelations.typeId, ARTIST_RELATION_TYPE_ID.MEMBER_OF_BAND)));
  const unique = [...new Set(members.map((m) => m.mbid))].slice(0, MAX_MEMBERS_PER_GROUP);
  let fetched = 0;
  for (const mbid of unique) {
    if (signal?.aborted) throw new Error('aborted');
    const before = await services.db.select({ relsFetchedAt: schema.mbArtists.relsFetchedAt }).from(schema.mbArtists).where(eq(schema.mbArtists.mbid, mbid)).limit(1);
    if (before[0]?.relsFetchedAt) continue;
    await ingestArtist(services, mbid);
    fetched++;
  }
  return fetched;
}

// ---------------------------------------------------------------- discography

/**
 * Studio albums for an artist: release groups with primary type Album, no
 * secondary types, credited to this artist alone, with at least one official
 * release. One release per group is marked canonical for its tracklist.
 */
export async function ingestDiscography(services: Services, artist: typeof schema.mbArtists.$inferSelect, signal?: AbortSignal): Promise<{ studioAlbums: number }> {
  const { db, musicbrainz, now } = services;
  if (artist.discographyFetchedAt && artist.discographyFetchedAt.getTime() > now().getTime() - 30 * DAY_MS) {
    const [row] = await db.select({ n: schema.mbReleaseGroups.mbid }).from(schema.mbReleaseGroups).where(and(eq(schema.mbReleaseGroups.primaryArtistMbid, artist.mbid), eq(schema.mbReleaseGroups.isStudioAlbum, true)));
    return { studioAlbums: row ? 1 : 0 };
  }

  const groups = await cachedBrowse<ReleaseGroup[]>(services, 'artist', artist.mbid, 'browse:release-groups:album', async () => {
    const collected: ReleaseGroup[] = [];
    for await (const group of musicbrainz.iterateReleaseGroups(artist.mbid, { type: 'album', inc: ['artist-credits'], priority: 0, signal })) collected.push(group);
    return collected;
  });
  const studio = groups.filter(
    (g) => g['primary-type'] === 'Album' && (g['secondary-types'] ?? []).length === 0 && (g['artist-credit']?.length ?? 1) === 1 && (g['artist-credit']?.[0]?.artist.id ?? artist.mbid) === artist.mbid,
  );
  const studioIds = new Set(studio.map((g) => g.id));
  if (studioIds.size === 0) {
    await db.update(schema.mbArtists).set({ discographyFetchedAt: now(), updatedAt: now() }).where(eq(schema.mbArtists.mbid, artist.mbid));
    return { studioAlbums: 0 };
  }

  const releases = await cachedBrowse<Release[]>(services, 'artist', artist.mbid, 'browse:releases:official', async () => {
    const collected: Release[] = [];
    for await (const release of musicbrainz.iterateReleases({ artist: artist.mbid, status: 'official', inc: ['release-groups', 'media'], priority: 0, signal })) collected.push(release);
    return collected;
  });
  const releasesByGroup = new Map<string, Release[]>();
  for (const release of releases) {
    const groupId = release['release-group']?.id;
    if (!groupId || !studioIds.has(groupId)) continue;
    releasesByGroup.set(groupId, [...(releasesByGroup.get(groupId) ?? []), release]);
  }

  const current = now();
  let studioAlbums = 0;
  for (const group of studio) {
    const groupReleases = releasesByGroup.get(group.id) ?? [];
    const hasOfficial = groupReleases.length > 0;
    const pick = pickCanonicalRelease(group, groupReleases, artist.country);
    const groupRow = {
      mbid: group.id,
      title: group.title,
      titleKey: nameKey(group.title),
      primaryType: group['primary-type'],
      secondaryTypes: group['secondary-types'] ?? [],
      firstReleaseDate: group['first-release-date'] ?? '',
      firstReleaseYear: yearOf(group['first-release-date']),
      disambiguation: group.disambiguation ?? '',
      primaryArtistMbid: artist.mbid,
      artistCredit: (group['artist-credit'] ?? []).map((c) => ({ name: c.name, joinphrase: c.joinphrase, artist: { id: c.artist.id, name: c.artist.name } })),
      artistCreditCount: group['artist-credit']?.length ?? 1,
      isStudioAlbum: hasOfficial,
      hasOfficialRelease: hasOfficial,
      canonicalReleaseMbid: pick?.release.id ?? null,
      fetchedAt: current,
      expiresAt: new Date(current.getTime() + 30 * DAY_MS),
      releasesFetchedAt: current,
    };
    await db.insert(schema.mbReleaseGroups).values(groupRow).onConflictDoUpdate({ target: schema.mbReleaseGroups.mbid, set: groupRow });
    if (hasOfficial) studioAlbums++;
    for (const release of groupReleases) {
      const releaseRow = {
        mbid: release.id,
        releaseGroupMbid: group.id,
        title: release.title,
        status: release.status ?? null,
        date: release.date ?? '',
        dateIsComplete: isCompleteDate(release.date),
        year: yearOf(release.date),
        country: release.country ?? null,
        barcode: release.barcode ?? null,
        packaging: release.packaging ?? null,
        quality: release.quality ?? null,
        disambiguation: release.disambiguation ?? '',
        mediumCount: release.media?.length ?? null,
        trackCount: totalTracks(release) || null,
        formats: [...new Set((release.media ?? []).map((m) => m.format).filter((f): f is string => !!f))],
        isCanonical: pick?.release.id === release.id,
        canonicalScore: pick?.release.id === release.id ? pick.score : null,
        fetchedAt: current,
        expiresAt: new Date(current.getTime() + 30 * DAY_MS),
      };
      // Clear a previous canonical flag first so the partial unique index never sees two.
      if (releaseRow.isCanonical) {
        await db.update(schema.mbReleases).set({ isCanonical: false }).where(and(eq(schema.mbReleases.releaseGroupMbid, group.id), eq(schema.mbReleases.isCanonical, true)));
      }
      await db.insert(schema.mbReleases).values(releaseRow).onConflictDoUpdate({ target: schema.mbReleases.mbid, set: releaseRow });
    }
  }
  await db.update(schema.mbArtists).set({ discographyFetchedAt: current, updatedAt: current }).where(eq(schema.mbArtists.mbid, artist.mbid));
  return { studioAlbums };
}

/** Fetch the canonical release's tracklist for each studio album of an artist, oldest first. */
export async function ingestTracklists(services: Services, artistMbid: string, signal?: AbortSignal): Promise<number> {
  const { db, now } = services;
  const groups = await db
    .select({ canonical: schema.mbReleaseGroups.canonicalReleaseMbid })
    .from(schema.mbReleaseGroups)
    .where(and(eq(schema.mbReleaseGroups.primaryArtistMbid, artistMbid), eq(schema.mbReleaseGroups.isStudioAlbum, true)))
    .orderBy(schema.mbReleaseGroups.firstReleaseDate)
    .limit(MAX_TRACKLISTS_PER_ARTIST);
  let fetched = 0;
  for (const group of groups) {
    if (!group.canonical) continue;
    if (signal?.aborted) throw new Error('aborted');
    const [release] = await db.select().from(schema.mbReleases).where(eq(schema.mbReleases.mbid, group.canonical)).limit(1);
    if (!release || (release.tracklistFetchedAt && release.tracklistFetchedAt.getTime() > now().getTime() - 90 * DAY_MS)) continue;
    await ingestTracklist(services, release.mbid, signal);
    fetched++;
  }
  await db.update(schema.mbArtists).set({ tracklistsFetchedAt: now(), updatedAt: now() }).where(eq(schema.mbArtists.mbid, artistMbid));
  return fetched;
}

export async function ingestTracklist(services: Services, releaseMbid: string, signal?: AbortSignal): Promise<void> {
  const { db, musicbrainz, now } = services;
  const release = await cachedEntity<Release>(services, 'release', releaseMbid, RELEASE_INC, () => musicbrainz.lookupRelease(releaseMbid, [...RELEASE_INC], { priority: 0, signal }), 90);
  const current = now();
  if (!release) {
    await db.update(schema.mbReleases).set({ tracklistFetchedAt: current }).where(eq(schema.mbReleases.mbid, releaseMbid));
    return;
  }
  const media = [...(release.media ?? [])].sort((a, b) => a.position - b.position);
  const lastMedium = media[media.length - 1];
  let absolute = 0;
  for (const medium of media) {
    const tracks = [...(medium.tracks ?? [])].sort((a, b) => a.position - b.position);
    for (const track of tracks) {
      absolute++;
      const recording = track.recording;
      const credit = track['artist-credit'] ?? recording['artist-credit'] ?? [];
      const recordingRow = {
        mbid: recording.id,
        title: recording.title,
        titleKey: nameKey(recording.title),
        lengthMs: recording.length ?? track.length ?? null,
        firstReleaseDate: recording['first-release-date'] ?? '',
        firstReleaseYear: yearOf(recording['first-release-date']),
        video: recording.video ?? false,
        disambiguation: recording.disambiguation ?? '',
        primaryArtistMbid: credit[0]?.artist.id ?? null,
        artistCredit: credit.map((c) => ({ name: c.name, joinphrase: c.joinphrase, artist: { id: c.artist.id, name: c.artist.name } })),
        fetchedAt: current,
        expiresAt: new Date(current.getTime() + 90 * DAY_MS),
      };
      await db.insert(schema.mbRecordings).values(recordingRow).onConflictDoUpdate({ target: schema.mbRecordings.mbid, set: recordingRow });
      const trackRow = {
        mbid: track.id,
        releaseMbid: release.id,
        recordingMbid: recording.id,
        mediumPosition: medium.position,
        mediumFormat: medium.format ?? null,
        mediumTrackCount: medium['track-count'] ?? tracks.length,
        position: track.position,
        number: track.number ?? String(track.position),
        absolutePosition: absolute,
        title: track.title,
        titleKey: nameKey(track.title),
        lengthMs: track.length ?? recording.length ?? null,
        isOpener: medium.position === media[0]?.position && track.position === tracks[0]?.position,
        isCloser: medium.position === lastMedium?.position && track.position === tracks[tracks.length - 1]?.position,
        artistCredit: credit.length > 0 ? credit.map((c) => ({ name: c.name, joinphrase: c.joinphrase, artist: { id: c.artist.id, name: c.artist.name } })) : null,
      };
      await db.insert(schema.mbTracks).values(trackRow).onConflictDoUpdate({ target: schema.mbTracks.mbid, set: trackRow });
    }
  }
  await db
    .update(schema.mbReleases)
    .set({ trackCount: absolute, mediumCount: media.length, tracklistFetchedAt: current })
    .where(eq(schema.mbReleases.mbid, releaseMbid));
}
