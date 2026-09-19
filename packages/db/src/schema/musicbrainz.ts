import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, emptyJsonArray, emptyTextArray, tstz, updatedAt } from './_common';
import { mbArtistType, mbEntityType, mbFetchStatus, releaseStatus, rgPrimaryType } from './enums';

/**
 * Raw WS/2 payloads keyed by (entity, mbid, inc). Everything normalised below
 * is re-derivable from here without another request. `not_found` rows are the
 * negative cache; 400s (client bugs) are never stored.
 */
export const mbCacheEntries = pgTable(
  'mb_cache_entries',
  {
    entityType: mbEntityType().notNull(),
    mbid: uuid().notNull(),
    /** The inc= string used, e.g. 'artist-rels url-rels aliases'. */
    inc: text().notNull().default(''),
    status: mbFetchStatus().notNull(),
    httpStatus: smallint(),
    etag: text(),
    payload: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    fetchedAt: createdAt(),
    expiresAt: tstz().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.mbid, t.inc] }), index('mb_cache_entries_expires_idx').on(t.expiresAt)],
);

/** MBIDs that answered 301: cache keys converge on the canonical id. */
export const mbMbidRedirects = pgTable(
  'mb_mbid_redirects',
  {
    oldMbid: uuid().primaryKey(),
    entityType: mbEntityType().notNull(),
    canonicalMbid: uuid().notNull(),
    observedAt: createdAt(),
  },
  (t) => [index('mb_mbid_redirects_canonical_idx').on(t.canonicalMbid)],
);

export const mbArtists = pgTable(
  'mb_artists',
  {
    mbid: uuid().primaryKey(),
    name: text().notNull(),
    sortName: text(),
    nameKey: text().notNull(),
    type: mbArtistType(),
    gender: text(),
    country: char({ length: 2 }),
    areaName: text(),
    beginAreaName: text(),
    /** Partial dates as MusicBrainz gives them: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
    lifeBegin: text(),
    lifeEnd: text(),
    lifeEnded: boolean().notNull().default(false),
    beginYear: smallint(),
    endYear: smallint(),
    disambiguation: text().notNull().default(''),
    aliases: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    tags: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    isSpecialPurpose: boolean().notNull().default(false),
    wikidataQid: text(),
    fetchStatus: mbFetchStatus().notNull().default('ok'),
    fetchedAt: tstz(),
    expiresAt: tstz(),
    relsFetchedAt: tstz(),
    discographyFetchedAt: tstz(),
    tracklistsFetchedAt: tstz(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('mb_artists_name_key_idx').on(t.nameKey),
    index('mb_artists_wikidata_idx').on(t.wikidataQid).where(sql`${t.wikidataQid} is not null`),
  ],
);

/**
 * Artist-artist relationships in canonical orientation (entity0 = person /
 * subgroup, entity1 = group), one row per stint with per-instrument rows merged
 * into `attributes`. Matched by `typeId`, never by name.
 */
export const mbArtistRelations = pgTable(
  'mb_artist_relations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entity0Mbid: uuid().notNull(),
    entity0Name: text().notNull(),
    entity1Mbid: uuid().notNull(),
    entity1Name: text().notNull(),
    typeId: uuid().notNull(),
    typeName: text().notNull(),
    beginDate: text(),
    endDate: text(),
    ended: boolean().notNull().default(false),
    beginYear: smallint(),
    endYear: smallint(),
    attributes: text().array().notNull().default(emptyTextArray),
    attributeValues: jsonb().$type<Record<string, string>>(),
    isOriginal: boolean().notNull().default(false),
    sourceCredit: text(),
    targetCredit: text(),
    fetchedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('mb_artist_relations_stint_uq').on(
      t.entity0Mbid,
      t.entity1Mbid,
      t.typeId,
      sql`coalesce(${t.beginDate}, '')`,
      sql`coalesce(${t.endDate}, '')`,
    ),
    index('mb_artist_relations_entity1_idx').on(t.entity1Mbid, t.typeId),
    index('mb_artist_relations_entity0_idx').on(t.entity0Mbid, t.typeId),
  ],
);

/** The album concept: release years and discography order come from here. */
export const mbReleaseGroups = pgTable(
  'mb_release_groups',
  {
    mbid: uuid().primaryKey(),
    title: text().notNull(),
    titleKey: text().notNull(),
    primaryType: rgPrimaryType(),
    secondaryTypes: text().array().notNull().default(emptyTextArray),
    /** '' when unknown; may be partial. Earliest non-cancelled release of any status. */
    firstReleaseDate: text().notNull().default(''),
    firstReleaseYear: smallint(),
    disambiguation: text().notNull().default(''),
    /** First credited artist; null for Various Artists compilations. */
    primaryArtistMbid: uuid().references(() => mbArtists.mbid, { onDelete: 'set null' }),
    artistCredit: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    artistCreditCount: smallint().notNull().default(1),
    /** primary type Album, no secondary types, at least one Official release. */
    isStudioAlbum: boolean().notNull().default(false),
    hasOfficialRelease: boolean(),
    canonicalReleaseMbid: uuid(),
    wikidataQid: text(),
    coverArtUrl: text(),
    coverArtCheckedAt: tstz(),
    fetchedAt: createdAt(),
    expiresAt: tstz(),
    releasesFetchedAt: tstz(),
  },
  (t) => [
    index('mb_release_groups_studio_idx')
      .on(t.primaryArtistMbid, t.firstReleaseYear)
      .where(sql`${t.isStudioAlbum} = true`),
    index('mb_release_groups_artist_title_idx').on(t.primaryArtistMbid, t.titleKey),
  ],
);

/** Concrete editions. Exactly one per group is `isCanonical` and carries the tracklist. */
export const mbReleases = pgTable(
  'mb_releases',
  {
    mbid: uuid().primaryKey(),
    releaseGroupMbid: uuid()
      .notNull()
      .references(() => mbReleaseGroups.mbid, { onDelete: 'cascade' }),
    title: text().notNull(),
    status: releaseStatus(),
    date: text().notNull().default(''),
    dateIsComplete: boolean().notNull().default(false),
    year: smallint(),
    country: char({ length: 2 }),
    barcode: text(),
    packaging: text(),
    quality: text(),
    disambiguation: text().notNull().default(''),
    mediumCount: smallint(),
    trackCount: integer(),
    formats: text().array().notNull().default(emptyTextArray),
    isCanonical: boolean().notNull().default(false),
    /** Why the picker chose it; lets the picker be re-run without refetching. */
    canonicalScore: integer(),
    tracklistFetchedAt: tstz(),
    creditsFetchedAt: tstz(),
    fetchedAt: createdAt(),
    expiresAt: tstz(),
  },
  (t) => [
    uniqueIndex('mb_releases_one_canonical_uq').on(t.releaseGroupMbid).where(sql`${t.isCanonical} = true`),
    index('mb_releases_group_status_idx').on(t.releaseGroupMbid, t.status, t.date),
  ],
);

export const mbRecordings = pgTable(
  'mb_recordings',
  {
    mbid: uuid().primaryKey(),
    title: text().notNull(),
    titleKey: text().notNull(),
    /** Median of track lengths across releases; can differ from the album track length. */
    lengthMs: integer(),
    firstReleaseDate: text().notNull().default(''),
    firstReleaseYear: smallint(),
    video: boolean().notNull().default(false),
    disambiguation: text().notNull().default(''),
    primaryArtistMbid: uuid(),
    artistCredit: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    isrcs: text().array().notNull().default(emptyTextArray),
    fetchedAt: createdAt(),
    expiresAt: tstz(),
    relsFetchedAt: tstz(),
  },
  (t) => [index('mb_recordings_artist_title_idx').on(t.primaryArtistMbid, t.titleKey)],
);

/** Tracklist of a canonical release: openers, closers and "which album contains" come from here. */
export const mbTracks = pgTable(
  'mb_tracks',
  {
    mbid: uuid().primaryKey(),
    releaseMbid: uuid()
      .notNull()
      .references(() => mbReleases.mbid, { onDelete: 'cascade' }),
    recordingMbid: uuid()
      .notNull()
      .references(() => mbRecordings.mbid, { onDelete: 'restrict' }),
    mediumPosition: smallint().notNull(),
    mediumFormat: text(),
    mediumTrackCount: smallint().notNull(),
    position: smallint().notNull(),
    /** As printed, e.g. 'A1'. */
    number: text().notNull().default(''),
    /** 1-based across all media. */
    absolutePosition: smallint().notNull(),
    title: text().notNull(),
    titleKey: text().notNull(),
    /** Track length on this release, in ms. */
    lengthMs: integer(),
    isOpener: boolean().notNull().default(false),
    isCloser: boolean().notNull().default(false),
    artistCredit: jsonb().$type<unknown[]>(),
  },
  (t) => [
    uniqueIndex('mb_tracks_position_uq').on(t.releaseMbid, t.mediumPosition, t.position),
    index('mb_tracks_release_abs_idx').on(t.releaseMbid, t.absolutePosition),
    index('mb_tracks_recording_idx').on(t.recordingMbid),
    index('mb_tracks_release_title_idx').on(t.releaseMbid, t.titleKey),
  ],
);

export const mbLabels = pgTable('mb_labels', {
  mbid: uuid().primaryKey(),
  name: text().notNull(),
  sortName: text(),
  type: text(),
  labelCode: integer(),
  country: char({ length: 2 }),
  disambiguation: text().notNull().default(''),
  wikidataQid: text(),
  fetchedAt: createdAt(),
});

export const mbReleaseLabels = pgTable(
  'mb_release_labels',
  {
    releaseMbid: uuid()
      .notNull()
      .references(() => mbReleases.mbid, { onDelete: 'cascade' }),
    labelMbid: uuid()
      .notNull()
      .references(() => mbLabels.mbid, { onDelete: 'cascade' }),
    catalogNumber: text().notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.releaseMbid, t.labelMbid, t.catalogNumber] }), index('mb_release_labels_label_idx').on(t.labelMbid)],
);

/** Recording-level artist credits (producer, engineer, mix...) for the optional toggles. */
export const mbRecordingCredits = pgTable(
  'mb_recording_credits',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    recordingMbid: uuid()
      .notNull()
      .references(() => mbRecordings.mbid, { onDelete: 'cascade' }),
    artistMbid: uuid().notNull(),
    artistName: text().notNull(),
    typeId: uuid().notNull(),
    typeName: text().notNull(),
    attributes: text().array().notNull().default(emptyTextArray),
    fetchedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('mb_recording_credits_uq').on(t.recordingMbid, t.artistMbid, t.typeId),
    index('mb_recording_credits_artist_idx').on(t.artistMbid, t.typeId),
  ],
);

/** Search results cached by normalised query so a name is searched once, with a TTL because the index lags. */
export const mbSearchCache = pgTable(
  'mb_search_cache',
  {
    entityType: mbEntityType().notNull(),
    queryKey: text().notNull(),
    query: text().notNull(),
    topMbid: uuid(),
    topScore: smallint(),
    /** True when the top hit clearly outranks the runner-up. */
    topIsUnique: boolean().notNull().default(false),
    candidates: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    searchedAt: createdAt(),
    expiresAt: tstz().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.queryKey] }), index('mb_search_cache_expires_idx').on(t.expiresAt)],
);
