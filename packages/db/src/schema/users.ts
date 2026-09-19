import { sql } from 'drizzle-orm';
import { boolean, customType, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, tstz, updatedAt } from './_common';
import { clientPlatform, difficulty, lastfmSessionStatus, quizMode } from './enums';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** One row per Last.fm account that has connected. Identified by username; Last.fm has no stable numeric id in the API. */
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
    /** From user.getInfo playcount; used for backfill progress before totals are known. */
    lastfmReportedPlaycount: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSeenAt: tstz(),
    /** Soft delete marker; the purge job removes the row (and cascades) afterwards. */
    deletedAt: tstz(),
  },
  (t) => [uniqueIndex('users_lastfm_username_key_uq').on(t.lastfmUsernameKey)],
);

/** Last.fm session keys never expire on their own; stored encrypted, one active per user. */
export const lastfmSessions = pgTable(
  'lastfm_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** AES-GCM ciphertext of the 32-hex session key; `keyVersion` selects the server key that wrapped it. */
    sessionKeyCiphertext: bytea().notNull(),
    keyVersion: smallint().notNull().default(1),
    subscriber: boolean().notNull().default(false),
    status: lastfmSessionStatus().notNull().default('active'),
    createdAt: createdAt(),
    lastUsedAt: tstz(),
    revokedAt: tstz(),
    /** e.g. 'lastfm_error_9', 'user_logout' */
    revokedReason: text(),
  },
  (t) => [uniqueIndex('lastfm_sessions_one_active_per_user').on(t.userId).where(sql`${t.status} = 'active'`)],
);

/**
 * One row per Connect attempt. The API creates it before redirecting to Last.fm
 * and consumes it in the callback, so a replayed 60-minute token is rejected.
 */
export const authFlows = pgTable(
  'auth_flows',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Random state echoed through the redirect; the callback looks the flow up by it. */
    state: text().notNull(),
    platform: clientPlatform().notNull(),
    /** Where to send the user afterwards: the web origin or quiztape://auth/callback. */
    returnTo: text().notNull(),
    /** sha256 of the Last.fm token once seen; unique so a token can be exchanged only once. */
    lastfmTokenHash: text(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    lastfmErrorCode: smallint(),
    /** sha256 of the one-time code sent back to the client; swapped for the bearer token via POST /v1/auth/exchange. */
    exchangeCodeHash: text(),
    exchangeExpiresAt: tstz(),
    exchangedAt: tstz(),
    appSessionId: uuid().references(() => appSessions.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: tstz().notNull(),
    consumedAt: tstz(),
  },
  (t) => [
    uniqueIndex('auth_flows_state_uq').on(t.state),
    uniqueIndex('auth_flows_token_hash_uq').on(t.lastfmTokenHash).where(sql`${t.lastfmTokenHash} is not null`),
    uniqueIndex('auth_flows_exchange_code_uq').on(t.exchangeCodeHash).where(sql`${t.exchangeCodeHash} is not null`),
    index('auth_flows_expires_idx').on(t.expiresAt).where(sql`${t.consumedAt} is null`),
  ],
);

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
);

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
});
