import { schema } from '@quiztape/db';
import {
  type AnswerResultDto,
  type AnswerSubmission,
  type CreateRoundRequest,
  MIN_ARTISTS_FOR_ROUND,
  MIN_PLAYS_FOR_QUESTIONS,
  POINTS_PER_QUESTION,
  type QuestionDto,
  type RoundDto,
  type RoundRecapItem,
  type RoundResultsDto,
  type RoundStateDto,
  isSideA,
} from '@quiztape/shared';
import { and, desc, eq, gt } from 'drizzle-orm';

import type { Services } from '../services';
import { awardPoints, grade } from './grading';
import { createRng, randomSeed } from './rng';
import { countEligibleArtists, generateSideAQuestions } from './side-a';
import { generateSideBQuestions } from './side-b';
import type { GeneratedQuestion, GeneratorContext } from './types';
import { triviaSummary } from '../lib/users';

export const GENERATOR_VERSION = 'sides-ab.v1';
const RECENT_FINGERPRINT_DAYS = 30;

export class RoundError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoundError';
  }
}

type RoundRow = typeof schema.rounds.$inferSelect;
type QuestionRow = typeof schema.roundQuestions.$inferSelect;

export async function createRound(services: Services, userId: string, request: CreateRoundRequest): Promise<RoundStateDto> {
  const { db, now } = services;
  if (request.mode === 'bracket') throw new RoundError(400, 'mode_not_available', 'Bracket arrives in build step 6.');

  const [sync] = await db.select().from(schema.userSyncState).where(eq(schema.userSyncState.userId, userId)).limit(1);
  if (!sync || sync.phase !== 'complete' || !sync.statsBuiltAt) {
    throw new RoundError(409, 'library_not_ready', 'Your listening history is still syncing. Rounds unlock when it is on tape.');
  }
  const eligible = await countEligibleArtists(db, userId);
  if (eligible < MIN_ARTISTS_FOR_ROUND) {
    throw new RoundError(
      409,
      'library_too_thin',
      `Quiztape needs at least ${MIN_ARTISTS_FOR_ROUND} artists with ${MIN_PLAYS_FOR_QUESTIONS}+ plays to cut a round; you have ${eligible}. Keep scrobbling.`,
    );
  }
  const [settings] = await db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).limit(1);
  const timerSeconds = settings?.timerSeconds ?? 20;

  const since = new Date(now().getTime() - RECENT_FINGERPRINT_DAYS * 86_400_000);
  const recent = await db
    .select({ fingerprint: schema.roundQuestions.fingerprint })
    .from(schema.roundQuestions)
    .where(and(eq(schema.roundQuestions.userId, userId), gt(schema.roundQuestions.createdAt, since)));

  if (request.mode !== 'side_a') {
    const trivia = await triviaSummary(services, userId);
    if (!trivia.ready) {
      throw new RoundError(
        409,
        'trivia_not_ready',
        trivia.running
          ? `Still loading band facts: ${trivia.readyArtists} of ${trivia.eligibleArtists} artists ready. Side A is playable meanwhile.`
          : `Band facts are not loaded yet for enough artists (${trivia.readyArtists} ready). Refresh to start loading.`,
      );
    }
  }

  const seed = randomSeed();
  const ctx: GeneratorContext = { db, userId, rng: createRng(seed), recentFingerprints: new Set(recent.map((r) => r.fingerprint)), usedArtistKeys: new Set() };
  const generated = await generateForMode(ctx, request);
  if (generated.length < Math.min(3, request.length)) {
    throw new RoundError(409, 'library_too_thin', 'Not enough distinct data to build a round yet. Keep scrobbling and try again.');
  }

  const current = now();
  const round = await db.transaction(async (tx) => {
    const [round] = await tx
      .insert(schema.rounds)
      .values({
        userId,
        mode: request.mode,
        difficulty: request.difficulty,
        requestedLength: request.length,
        questionCount: generated.length,
        status: 'active',
        seed,
        generatorVersion: GENERATOR_VERSION,
        optionalCategories: [],
        statsSnapshotAt: sync.statsBuiltThrough,
        timerSeconds,
        maxScore: generated.length * POINTS_PER_QUESTION,
        createdAt: current,
        startedAt: current,
      })
      .returning();
    await tx.insert(schema.roundQuestions).values(generated.map((q, index) => toRow(q, round!.id, userId, index, timerSeconds)));
    return round!;
  });

  const question = await questionAt(services, round.id, 0);
  return { round: toRoundDto(round, 0), question: question ? toQuestionDto(question, round.questionCount) : null };
}

export async function getRoundState(services: Services, userId: string, roundId: string): Promise<RoundStateDto> {
  const round = await loadRound(services, userId, roundId);
  const streak = await currentStreak(services, roundId);
  if (round.status !== 'active') return { round: toRoundDto(round, streak), question: null };
  const question = await questionAt(services, roundId, round.currentIndex);
  return { round: toRoundDto(round, streak), question: question ? toQuestionDto(question, round.questionCount) : null };
}

export async function submitAnswer(
  services: Services,
  userId: string,
  roundId: string,
  input: { questionId: string; submission: AnswerSubmission; responseMs: number | null },
): Promise<AnswerResultDto> {
  const { db, now } = services;
  const round = await loadRound(services, userId, roundId);
  if (round.status !== 'active') throw new RoundError(409, 'round_not_active', 'This round is over.');
  const question = await questionAt(services, roundId, round.currentIndex);
  if (!question) throw new RoundError(409, 'round_exhausted', 'No question is waiting.');
  if (question.id !== input.questionId) throw new RoundError(409, 'wrong_question', 'That is not the current question.');

  const graded = grade({
    answerFormat: question.answerFormat,
    submission: input.submission,
    correctAnswer: question.correctAnswer,
    acceptedAnswers: acceptedAnswersOf(question),
    numericAnswer: question.numericAnswer === null ? null : Number(question.numericAnswer),
    numericTolerance: question.numericTolerance === null ? null : Number(question.numericTolerance),
    options: optionsOf(question),
  });
  const responseMs = input.responseMs !== null && Number.isFinite(input.responseMs) ? Math.max(0, Math.round(input.responseMs)) : null;
  const points = awardPoints(graded.correct, responseMs, question.timeLimitSeconds, question.points);
  const current = now();

  const previousStreak = await currentStreak(services, roundId);
  const streak = graded.correct ? previousStreak + 1 : 0;
  const nextIndex = round.currentIndex + 1;
  const completed = nextIndex >= round.questionCount;

  const updated = await db.transaction(async (tx) => {
    await tx.insert(schema.answers).values({
      questionId: question.id,
      roundId,
      userId,
      submittedAt: current,
      responseMs,
      rawText: input.submission.kind === 'text' ? input.submission.text : null,
      rawJson: input.submission,
      normalizedText: graded.normalizedText,
      isCorrect: graded.correct,
      gradingMethod: graded.method,
      gradingScore: graded.score === null ? null : graded.score.toFixed(4),
      gradingDetail: { yourAnswerDisplay: graded.yourAnswerDisplay },
      pointsAwarded: points,
      gradedAt: current,
    });
    const [row] = await tx
      .update(schema.rounds)
      .set({
        currentIndex: nextIndex,
        score: round.score + points,
        correctCount: round.correctCount + (graded.correct ? 1 : 0),
        bestStreak: Math.max(round.bestStreak, streak),
        status: completed ? 'completed' : 'active',
        completedAt: completed ? current : null,
      })
      .where(eq(schema.rounds.id, roundId))
      .returning();
    return row!;
  });

  const next = completed ? null : await questionAt(services, roundId, nextIndex);
  return {
    questionId: question.id,
    correct: graded.correct,
    correctDisplay: question.correctDisplay,
    yourAnswerDisplay: graded.yourAnswerDisplay,
    explanation: explanationOf(question),
    gradingMethod: graded.method,
    pointsAwarded: points,
    round: toRoundDto(updated, streak),
    nextQuestion: next ? toQuestionDto(next, updated.questionCount) : null,
  };
}

export async function getResults(services: Services, userId: string, roundId: string): Promise<RoundResultsDto> {
  const { db } = services;
  const round = await loadRound(services, userId, roundId);
  const [user] = await db.select({ lastfmUsername: schema.users.lastfmUsername }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const rows = await db
    .select({ question: schema.roundQuestions, answer: schema.answers })
    .from(schema.roundQuestions)
    .leftJoin(schema.answers, eq(schema.answers.questionId, schema.roundQuestions.id))
    .where(eq(schema.roundQuestions.roundId, roundId))
    .orderBy(schema.roundQuestions.position);
  const items: RoundRecapItem[] = rows.map(({ question, answer }) => ({
    position: question.position,
    category: question.category,
    prompt: question.prompt,
    correctDisplay: question.correctDisplay,
    yourAnswerDisplay: ((answer?.gradingDetail as { yourAnswerDisplay?: string | null } | null)?.yourAnswerDisplay ?? null) as string | null,
    explanation: explanationOf(question),
    correct: answer?.isCorrect ?? false,
    pointsAwarded: answer?.pointsAwarded ?? 0,
    responseMs: answer?.responseMs ?? null,
  }));
  const streak = await currentStreak(services, roundId);
  return { round: toRoundDto(round, streak), items, user: { lastfmUsername: user?.lastfmUsername ?? '' } };
}

export async function abandonRound(services: Services, userId: string, roundId: string): Promise<RoundDto> {
  const round = await loadRound(services, userId, roundId);
  if (round.status !== 'active') return toRoundDto(round, 0);
  const [updated] = await services.db
    .update(schema.rounds)
    .set({ status: 'abandoned', completedAt: services.now() })
    .where(eq(schema.rounds.id, roundId))
    .returning();
  return toRoundDto(updated!, 0);
}

/** Side A, Side B, or a mixtape that alternates the two. */
async function generateForMode(ctx: GeneratorContext, request: CreateRoundRequest): Promise<GeneratedQuestion[]> {
  const options = { difficulty: request.difficulty, count: request.length };
  if (request.mode === 'side_a') return generateSideAQuestions(ctx, options);
  if (request.mode === 'side_b') return generateSideBQuestions(ctx, options);
  const half = Math.ceil(request.length / 2);
  const sideA = await generateSideAQuestions(ctx, { difficulty: request.difficulty, count: half });
  const sideB = await generateSideBQuestions(ctx, { difficulty: request.difficulty, count: request.length - sideA.length });
  const mixed: GeneratedQuestion[] = [];
  const [first, second] = ctx.rng.next() < 0.5 ? [sideA, sideB] : [sideB, sideA];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) mixed.push(first[i]!);
    if (second[i]) mixed.push(second[i]!);
  }
  return mixed.slice(0, request.length);
}

// ------------------------------------------------------------------ helpers

async function loadRound(services: Services, userId: string, roundId: string): Promise<RoundRow> {
  const [round] = await services.db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.id, roundId), eq(schema.rounds.userId, userId)))
    .limit(1);
  if (!round) throw new RoundError(404, 'round_not_found', 'No such round.');
  return round;
}

async function questionAt(services: Services, roundId: string, position: number): Promise<QuestionRow | null> {
  const [question] = await services.db
    .select()
    .from(schema.roundQuestions)
    .where(and(eq(schema.roundQuestions.roundId, roundId), eq(schema.roundQuestions.position, position)))
    .limit(1);
  return question ?? null;
}

/** Consecutive correct answers ending at the latest answered question. */
async function currentStreak(services: Services, roundId: string): Promise<number> {
  const rows = await services.db
    .select({ isCorrect: schema.answers.isCorrect, position: schema.roundQuestions.position })
    .from(schema.answers)
    .innerJoin(schema.roundQuestions, eq(schema.roundQuestions.id, schema.answers.questionId))
    .where(eq(schema.answers.roundId, roundId))
    .orderBy(desc(schema.roundQuestions.position));
  let streak = 0;
  for (const row of rows) {
    if (!row.isCorrect) break;
    streak++;
  }
  return streak;
}

function toRow(q: GeneratedQuestion, roundId: string, userId: string, position: number, timeLimitSeconds: number): typeof schema.roundQuestions.$inferInsert {
  return {
    roundId,
    userId,
    position,
    category: q.category,
    difficulty: q.difficulty,
    answerFormat: q.answerFormat,
    templateId: q.templateId,
    prompt: q.prompt,
    payload: {
      hint: q.hint,
      options: q.options,
      unit: q.unit,
      explanation: q.explanation,
      acceptedAnswers: q.acceptedAnswers,
    },
    correctAnswer: q.correctAnswer,
    correctDisplay: q.correctDisplay,
    numericAnswer: q.numericAnswer === null ? null : String(q.numericAnswer),
    numericTolerance: q.numericTolerance === null ? null : String(q.numericTolerance),
    anchorArtistKey: q.anchorArtistKey,
    anchorArtistMbid: q.anchorArtistMbid,
    anchorReleaseGroupMbid: q.anchorReleaseGroupMbid,
    anchorRecordingMbid: q.anchorRecordingMbid,
    anchorYear: q.anchorYear,
    factRefs: q.factRefs,
    fingerprint: q.fingerprint,
    points: POINTS_PER_QUESTION,
    timeLimitSeconds,
  };
}

type Payload = { hint?: string | null; options?: { id: string; label: string }[] | null; unit?: string | null; explanation?: string | null; acceptedAnswers?: string[] };

function payloadOf(question: QuestionRow): Payload {
  return (question.payload ?? {}) as Payload;
}
function optionsOf(question: QuestionRow) {
  return payloadOf(question).options ?? null;
}
function acceptedAnswersOf(question: QuestionRow): string[] {
  return payloadOf(question).acceptedAnswers ?? [];
}
function explanationOf(question: QuestionRow): string | null {
  return payloadOf(question).explanation ?? null;
}

/** Strip everything that would give the answer away. */
export function toQuestionDto(question: QuestionRow, total: number): QuestionDto {
  const payload = payloadOf(question);
  return {
    id: question.id,
    position: question.position,
    total,
    category: question.category,
    side: isSideA(question.category) ? 'a' : 'b',
    difficulty: question.difficulty,
    answerFormat: question.answerFormat,
    prompt: question.prompt,
    hint: payload.hint ?? null,
    options: payload.options ?? null,
    unit: payload.unit ?? null,
    timeLimitSeconds: question.timeLimitSeconds,
    points: question.points,
  };
}

export function toRoundDto(round: RoundRow, currentStreakValue: number): RoundDto {
  return {
    id: round.id,
    mode: round.mode,
    difficulty: round.difficulty,
    status: round.status,
    questionCount: round.questionCount,
    currentIndex: round.currentIndex,
    score: round.score,
    maxScore: round.maxScore,
    correctCount: round.correctCount,
    bestStreak: round.bestStreak,
    currentStreak: currentStreakValue,
    timerSeconds: round.timerSeconds,
    createdAt: round.createdAt.toISOString(),
    completedAt: round.completedAt?.toISOString() ?? null,
  };
}
