import { sql } from 'drizzle-orm';
import { char, index, jsonb, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, emptyJsonArray, emptyJsonObject, tstz } from './_common';
import { mbEntityType, wdResolution } from './enums';
import { mbArtists } from './musicbrainz';

/** MBID -> Q-item mapping. `mb_url_rel` came free with the MusicBrainz lookup; the rest via Wikidata. */
export const wdEntityLinks = pgTable(
  'wd_entity_links',
  {
    entityType: mbEntityType().notNull(),
    mbid: uuid().notNull(),
    qid: text(),
    resolution: wdResolution().notNull().default('pending'),
    candidateQids: text().array().notNull().default(sql`'{}'::text[]`),
    resolvedAt: tstz(),
    nextRetryAt: tstz(),
  },
  (t) => [
    primaryKey({ columns: [t.entityType, t.mbid] }),
    index('wd_entity_links_retry_idx').on(t.nextRetryAt).where(sql`${t.resolution} = 'pending'`),
  ],
);

/** Raw item claims, so facts can be re-derived without another request. */
export const wdEntities = pgTable(
  'wd_entities',
  {
    qid: text().primaryKey(),
    labelEn: text(),
    descriptionEn: text(),
    enwikiTitle: text(),
    redirectToQid: text(),
    claims: jsonb().$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    fetchedAt: createdAt(),
    expiresAt: tstz().notNull(),
  },
  (t) => [index('wd_entities_expires_idx').on(t.expiresAt)],
);

/** Facts extracted for the optional geography / label toggles. */
export const wdArtistFacts = pgTable('wd_artist_facts', {
  mbArtistMbid: uuid()
    .primaryKey()
    .references(() => mbArtists.mbid, { onDelete: 'cascade' }),
  qid: text().notNull(),
  /** P740 for groups, P19 for people. */
  originPlaceQid: text(),
  originPlaceLabel: text(),
  /** P495 for groups, P27 for people. */
  countryQid: text(),
  countryLabel: text(),
  countryIso: char({ length: 2 }),
  /** P571 as '+1960-00-00T00:00:00Z' with precision 9 = year, 10 = month, 11 = day. */
  inception: text(),
  inceptionPrecision: smallint(),
  dissolved: text(),
  genres: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
  recordLabels: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
  extractedAt: createdAt(),
});
