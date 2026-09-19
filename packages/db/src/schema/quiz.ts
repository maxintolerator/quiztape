import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, emptyJsonArray, emptyJsonObject, emptyTextArray, tstz } from './_common';
import { answerFormat, difficulty, gradingMethod, llmPurpose, questionCategory, quizMode, roundStatus } from './enums';
import { users } from './users';

/** One quiz round. Questions are generated up front and stored, so a round is replayable and shareable. */
export const rounds = pgTable(
  'rounds',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: quizMode().notNull(),
    difficulty: difficulty().notNull(),
    requestedLength: smallint().notNull(),
    /** Actual count; thin libraries may yield fewer questions than requested. */
    questionCount: smallint().notNull().default(0),
    status: roundStatus().notNull().default('draft'),
    seed: bigint({ mode: 'number' }).notNull(),
    generatorVersion: text().notNull(),
    /** Optional categories that were switched on when the round was generated. */
    optionalCategories: text().array().notNull().default(emptyTextArray),
    /** Rollup snapshot the questions were generated from (user_sync_state.stats_built_through). */
    statsSnapshotAt: tstz(),
    timerSeconds: smallint().notNull(),
    currentIndex: smallint().notNull().default(0),
    score: integer().notNull().default(0),
    maxScore: integer().notNull().default(0),
    correctCount: smallint().notNull().default(0),
    bestStreak: smallint().notNull().default(0),
    /** Public slug for the results card; null until shared. */
    shareSlug: text(),
    createdAt: createdAt(),
    startedAt: tstz(),
    completedAt: tstz(),
  },
  (t) => [
    index('rounds_user_created_idx').on(t.userId, t.createdAt),
    uniqueIndex('rounds_share_slug_uq').on(t.shareSlug).where(sql`${t.shareSlug} is not null`),
    index('rounds_leaderboard_idx').on(t.mode, t.difficulty, t.score).where(sql`${t.status} = 'completed'`),
  ],
);

export const roundQuestions = pgTable(
  'round_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    roundId: uuid()
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: smallint().notNull(),
    category: questionCategory().notNull(),
    difficulty: difficulty().notNull(),
    answerFormat: answerFormat().notNull(),
    /** Which template produced it, e.g. 'stats_artist_rank.v1'. */
    templateId: text().notNull(),
    prompt: text().notNull(),
    promptRephrased: text(),
    /** Choices, items to order, display hints. */
    payload: jsonb().$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    correctAnswer: jsonb().$type<unknown>().notNull(),
    /** Human-readable correct answer, always shown after grading. */
    correctDisplay: text().notNull(),
    numericAnswer: numeric({ precision: 14, scale: 3 }),
    numericTolerance: numeric({ precision: 14, scale: 3 }),
    /** What the question is about, for repeat avoidance and recaps. */
    anchorArtistKey: text(),
    anchorArtistMbid: uuid(),
    anchorReleaseGroupMbid: uuid(),
    anchorRecordingMbid: uuid(),
    anchorYear: smallint(),
    /** Provenance: which cached rows / stats produced the fact. */
    factRefs: jsonb().$type<unknown[]>().notNull().default(emptyJsonArray),
    /** Stable hash of (template, anchors, answer) so the same question is not asked again soon. */
    fingerprint: text().notNull(),
    points: smallint().notNull().default(1),
    timeLimitSeconds: smallint().notNull(),
    servedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('round_questions_position_uq').on(t.roundId, t.position),
    index('round_questions_fingerprint_idx').on(t.userId, t.fingerprint, t.createdAt),
  ],
);

export const answers = pgTable(
  'answers',
  {
    id: uuid().primaryKey().defaultRandom(),
    questionId: uuid()
      .notNull()
      .references(() => roundQuestions.id, { onDelete: 'cascade' }),
    roundId: uuid()
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    submittedAt: createdAt(),
    responseMs: integer(),
    rawText: text(),
    rawJson: jsonb().$type<unknown>(),
    normalizedText: text(),
    isCorrect: boolean().notNull(),
    gradingMethod: gradingMethod().notNull(),
    /** Similarity 0..1 for fuzzy grading, or LLM confidence. */
    gradingScore: numeric({ precision: 5, scale: 4 }),
    gradingDetail: jsonb().$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    pointsAwarded: smallint().notNull().default(0),
    gradedAt: createdAt(),
  },
  (t) => [uniqueIndex('answers_question_uq').on(t.questionId), index('answers_round_idx').on(t.roundId)],
);

/** Every Claude call, for cost tracking and caching identical rephrasings. Never used for facts. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    purpose: llmPurpose().notNull(),
    cacheKey: text(),
    questionId: uuid().references(() => roundQuestions.id, { onDelete: 'set null' }),
    model: text().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    latencyMs: integer(),
    request: jsonb().$type<Record<string, unknown>>().notNull(),
    response: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('llm_calls_cache_key_uq').on(t.cacheKey).where(sql`${t.cacheKey} is not null`), index('llm_calls_created_idx').on(t.createdAt)],
);
