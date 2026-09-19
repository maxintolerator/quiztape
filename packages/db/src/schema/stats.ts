import { index, integer, pgTable, primaryKey, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, tstz } from './_common';
import { difficulty } from './enums';
import { users } from './users';

/**
 * Per-user rollups rebuilt from `scrobbles` after every sync (one GROUP BY
 * each). Side A questions read these, never the fact table. `difficulty`
 * is computed in application code with `difficultyFor` from @quiztape/shared
 * so the rule lives in one place.
 */
export const userArtistStats = pgTable(
  'user_artist_stats',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    artistKey: text().notNull(),
    artistName: text().notNull(),
    playCount: integer().notNull(),
    rank: integer().notNull(),
    difficulty: difficulty().notNull(),
    firstPlayedAt: tstz().notNull(),
    lastPlayedAt: tstz().notNull(),
    distinctTracks: integer().notNull().default(0),
    distinctAlbums: integer().notNull().default(0),
    computedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.artistKey] }),
    uniqueIndex('user_artist_stats_rank_uq').on(t.userId, t.rank),
    index('user_artist_stats_difficulty_idx').on(t.userId, t.difficulty, t.rank),
    index('user_artist_stats_first_played_idx').on(t.userId, t.firstPlayedAt),
  ],
);

export const userTrackStats = pgTable(
  'user_track_stats',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    artistKey: text().notNull(),
    trackKey: text().notNull(),
    trackName: text().notNull(),
    playCount: integer().notNull(),
    rankOverall: integer().notNull(),
    rankInArtist: integer().notNull(),
    firstPlayedAt: tstz().notNull(),
    lastPlayedAt: tstz().notNull(),
    computedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.artistKey, t.trackKey] }),
    index('user_track_stats_in_artist_idx').on(t.userId, t.artistKey, t.rankInArtist),
    index('user_track_stats_overall_idx').on(t.userId, t.rankOverall),
  ],
);

export const userAlbumStats = pgTable(
  'user_album_stats',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    artistKey: text().notNull(),
    albumKey: text().notNull(),
    albumName: text().notNull(),
    playCount: integer().notNull(),
    rankOverall: integer().notNull(),
    rankInArtist: integer().notNull(),
    firstPlayedAt: tstz().notNull(),
    computedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.artistKey, t.albumKey] }),
    index('user_album_stats_in_artist_idx').on(t.userId, t.artistKey, t.rankInArtist),
    index('user_album_stats_overall_idx').on(t.userId, t.rankOverall),
  ],
);

/** Year chart toppers, computed in the user's timezone at rebuild time. */
export const userYearArtistStats = pgTable(
  'user_year_artist_stats',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    year: smallint().notNull(),
    artistKey: text().notNull(),
    playCount: integer().notNull(),
    rankInYear: integer().notNull(),
    computedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.year, t.artistKey] }),
    uniqueIndex('user_year_artist_stats_rank_uq').on(t.userId, t.year, t.rankInYear),
  ],
);
