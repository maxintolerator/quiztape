import { sql } from 'drizzle-orm';
import { type AnyPgColumn, boolean, check, index, integer, pgTable, primaryKey, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, tstz } from './_common';
import { bracketStatus } from './enums';
import { users } from './users';

/** Single-elimination tournament seeded from the user's top artists. */
export const brackets = pgTable(
  'brackets',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    size: smallint().notNull(),
    roundCount: smallint().notNull(),
    status: bracketStatus().notNull().default('active'),
    currentRound: smallint().notNull().default(1),
    championSeed: smallint(),
    /** "Which did you play more" duel tally. */
    duelsCorrect: smallint().notNull().default(0),
    duelsTotal: smallint().notNull().default(0),
    statsSnapshotAt: tstz(),
    shareSlug: text(),
    createdAt: createdAt(),
    completedAt: tstz(),
  },
  (t) => [
    index('brackets_user_created_idx').on(t.userId, t.createdAt),
    uniqueIndex('brackets_share_slug_uq').on(t.shareSlug).where(sql`${t.shareSlug} is not null`),
    check('brackets_size_pow2', sql`${t.size} in (4, 8, 16, 32)`),
  ],
);

export const bracketEntrants = pgTable(
  'bracket_entrants',
  {
    bracketId: uuid()
      .notNull()
      .references(() => brackets.id, { onDelete: 'cascade' }),
    seed: smallint().notNull(),
    artistKey: text().notNull(),
    artistName: text().notNull(),
    artistMbid: uuid(),
    playCount: integer().notNull(),
    eliminatedInRound: smallint(),
  },
  (t) => [primaryKey({ columns: [t.bracketId, t.seed] }), uniqueIndex('bracket_entrants_artist_uq').on(t.bracketId, t.artistKey)],
);

/** One match per slot; the winner feeds `nextMatchId` at `nextSlot` (1 or 2). */
export const bracketMatches = pgTable(
  'bracket_matches',
  {
    id: uuid().primaryKey().defaultRandom(),
    bracketId: uuid()
      .notNull()
      .references(() => brackets.id, { onDelete: 'cascade' }),
    roundNo: smallint().notNull(),
    matchNo: smallint().notNull(),
    seedA: smallint(),
    seedB: smallint(),
    winnerSeed: smallint(),
    nextMatchId: uuid().references((): AnyPgColumn => bracketMatches.id, { onDelete: 'set null' }),
    nextSlot: smallint(),
    /** The duel: which of the two did you play more? */
    duelGuessSeed: smallint(),
    duelCorrect: boolean(),
    pickedAt: tstz(),
    duelAnsweredAt: tstz(),
  },
  (t) => [
    uniqueIndex('bracket_matches_slot_uq').on(t.bracketId, t.roundNo, t.matchNo),
    index('bracket_matches_next_idx').on(t.nextMatchId),
  ],
);
