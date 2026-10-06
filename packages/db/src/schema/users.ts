import { boolean, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, tstz, updatedAt } from './_common';
import { clientPlatform, difficulty, quizMode } from './enums';

/** One row per Last.fm username that has signed in. Identified by username; Last.fm has no stable numeric id in the API. */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    lastfmUsername: text().notNull(),
    /** lower(lastfm_username): Last.fm usernames are case-insensitive. */
    lastfmUsernameKey: text().notNull(),
    lastfmUrl: text(),
    realName: text(),
    country: text(),
    /** From user.getInfo registered.unixtime. */
    lastfmRegisteredAt: tstz(),
    /** From user.getInfo playcount at the latest sign-in. */
    lastfmReportedPlaycount: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSeenAt: tstz(),
    /** Soft delete marker; the purge job removes the row (and cascades) afterwards. */
    deletedAt: tstz(),
  },
  (t) => [uniqueIndex('users_lastfm_username_key_uq').on(t.lastfmUsernameKey)],
).enableRLS();

/** The app's own bearer session handed to the client; only its hash is stored. */
export const appSessions = pgTable(
  'app_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    platform: clientPlatform().notNull(),
    createdAt: createdAt(),
    expiresAt: tstz().notNull(),
    lastSeenAt: tstz(),
    revokedAt: tstz(),
  },
  (t) => [uniqueIndex('app_sessions_token_hash_uq').on(t.tokenHash), index('app_sessions_user_idx').on(t.userId, t.expiresAt)],
).enableRLS();

/** Per-user preferences, including the optional question toggles (all default off). */
export const userSettings = pgTable('user_settings', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  geoOriginEnabled: boolean().notNull().default(false),
  producerEnabled: boolean().notNull().default(false),
  labelEnabled: boolean().notNull().default(false),
  defaultMode: quizMode().notNull().default('mixtape'),
  defaultDifficulty: difficulty().notNull().default('medium'),
  defaultRoundLength: smallint().notNull().default(10),
  timerSeconds: smallint().notNull().default(20),
  /** IANA zone used for "in 2019 your top artist was" style questions. */
  timezone: text().notNull().default('UTC'),
  llmRephraseEnabled: boolean().notNull().default(true),
  updatedAt: updatedAt(),
}).enableRLS();
