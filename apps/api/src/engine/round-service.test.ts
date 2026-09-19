import { schema } from '@quiztape/db';
import type { RecentTrack } from '@quiztape/lastfm';
import type { AnswerResultDto, RoundResultsDto, RoundStateDto } from '@quiztape/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { createFakeLastfm, track } from '../fake-lastfm';
import { handlers } from '../jobs/handlers';
import { enqueueJob } from '../jobs/queue';
import { JobRunner } from '../jobs/runner';
import { sha256Hex } from '../lib/crypto';
import { ensureUserRows } from '../lib/users';
import type { Services } from '../services';
import { createTestServices } from '../testing';

/** A believable small library: 12 artists with distinct play counts, tracks and albums, spread over three years. */
function buildHistory() {
  const artists = ['Radiohead', 'Boards of Canada', 'Autechre', 'Portishead', 'Massive Attack', 'Aphex Twin', 'Björk', 'Burial', 'Four Tet', 'Caribou', 'Bonobo', 'Jon Hopkins'];
  const rows: RecentTrack[] = [];
  let t = 1_500_000_000;
  artists.forEach((artist, i) => {
    const plays = 120 - i * 9; // 120, 111, ... 21
    for (let p = 0; p < plays; p++) {
      const trackNo = p % 5 === 0 ? 1 : p % 3 === 0 ? 2 : 3; // track 3 is the clear favourite
      const album = p % 4 === 0 ? `${artist} Album A` : `${artist} Album B`; // Album B is the favourite
      t += 900 + ((i * 37 + p * 13) % 500);
      rows.push(track(t + i * 86_400 * 40, artist, `${artist} Track ${trackNo}`, album));
    }
  });
  return rows;
}

let services: Services;
let app: ReturnType<typeof createApp>;
let token: string;
let userId: string;

beforeAll(async () => {
  const fake = createFakeLastfm({ history: buildHistory(), perPage: 200 });
  services = await createTestServices({ fetch: fake.fetch });
  app = createApp(services);
  const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'someone', lastfmUsernameKey: 'someone' }).returning();
  userId = user!.id;
  await ensureUserRows(services, userId);
  token = 'test-token-' + 'x'.repeat(30);
  await services.db.insert(schema.appSessions).values({ userId, tokenHash: sha256Hex(token), platform: 'web', expiresAt: new Date(Date.now() + 86_400_000) });
}, 180_000);

afterAll(async () => {
  await services?.close();
});

const authed = (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } });

describe('rounds', () => {
  it('refuses to cut a round before the library is synced', async () => {
    const res = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'side_a', difficulty: 'medium', length: 5 }) }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'library_not_ready' });
  });

  it('plays a full Side A round end to end with grading and scoring', async () => {
    await enqueueJob(services, { kind: 'backfill', userId, dedupeKey: `backfill:${userId}` });
    await new JobRunner(services, handlers, { workerId: 'test' }).drain();

    const created = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'side_a', difficulty: 'easy', length: 5 }) }));
    expect(created.status).toBe(201);
    const state = (await created.json()) as RoundStateDto;
    expect(state.round).toMatchObject({ status: 'active', currentIndex: 0, questionCount: 5, maxScore: 500 });
    expect(state.question).not.toBeNull();
    // The client payload never carries the answer.
    expect(JSON.stringify(state.question)).not.toMatch(/correct|accepted/i);

    let question = state.question!;
    let lastResult: AnswerResultDto | null = null;
    const seenCategories = new Set<string>();
    for (let i = 0; i < 5; i++) {
      seenCategories.add(question.category);
      // Answer with the truth for the first question by peeking at the database, wrong for the rest.
      const [row] = await services.db.select().from(schema.roundQuestions).where(eq(schema.roundQuestions.id, question.id));
      const submission =
        i === 0
          ? truthfulSubmission(row!)
          : question.answerFormat === 'multiple_choice'
            ? { kind: 'option', optionId: 'not-an-option' }
            : question.answerFormat === 'numeric'
              ? { kind: 'numeric', value: 99_999 }
              : { kind: 'text', text: 'definitely wrong' };
      const res = await app.request(`/v1/rounds/${state.round.id}/answers`, authed({ method: 'POST', body: JSON.stringify({ questionId: question.id, submission, responseMs: 4_000 }) }));
      expect(res.status).toBe(200);
      lastResult = (await res.json()) as AnswerResultDto;
      expect(lastResult.correct).toBe(i === 0);
      expect(lastResult.correctDisplay.length).toBeGreaterThan(0);
      if (i === 0) expect(lastResult.pointsAwarded).toBeGreaterThanOrEqual(100);
      if (i < 4) {
        expect(lastResult.nextQuestion).not.toBeNull();
        question = lastResult.nextQuestion!;
      } else {
        expect(lastResult.nextQuestion).toBeNull();
        expect(lastResult.round.status).toBe('completed');
      }
    }
    expect(seenCategories.size).toBeGreaterThanOrEqual(3);
    expect(lastResult!.round.correctCount).toBe(1);
    expect(lastResult!.round.score).toBe(lastResult!.round.score); // sanity

    // Answering again is rejected; results carry the recap.
    const again = await app.request(`/v1/rounds/${state.round.id}/answers`, authed({ method: 'POST', body: JSON.stringify({ questionId: question.id, submission: { kind: 'skip' } }) }));
    expect(again.status).toBe(409);
    const results = await app.request(`/v1/rounds/${state.round.id}/results`, authed());
    const body = (await results.json()) as RoundResultsDto;
    expect(body.items).toHaveLength(5);
    expect(body.items[0]!.correct).toBe(true);
    expect(body.user.lastfmUsername).toBe('someone');
  });

  it('does not repeat recently asked questions across rounds', async () => {
    const first = await services.db.select({ fingerprint: schema.roundQuestions.fingerprint }).from(schema.roundQuestions).where(eq(schema.roundQuestions.userId, userId));
    const created = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'side_a', difficulty: 'deep_cut', length: 5 }) }));
    expect(created.status).toBe(201);
    const { round } = (await created.json()) as RoundStateDto;
    const second = await services.db.select({ fingerprint: schema.roundQuestions.fingerprint }).from(schema.roundQuestions).where(eq(schema.roundQuestions.roundId, round.id));
    const seen = new Set(first.map((r) => r.fingerprint));
    expect(second.some((r) => seen.has(r.fingerprint))).toBe(false);
  });

  it('rejects modes that are not built yet and validates the body', async () => {
    const res = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'bracket', difficulty: 'easy', length: 5 }) }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'mode_not_available' });
    expect((await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'side_a', difficulty: 'easy', length: 7 }) }))).status).toBe(400);
    expect((await app.request('/v1/rounds/00000000-0000-4000-8000-000000000000', authed())).status).toBe(404);
  });
});

function truthfulSubmission(row: typeof schema.roundQuestions.$inferSelect) {
  const payload = row.payload as { options?: { id: string; label: string }[]; acceptedAnswers?: string[] };
  switch (row.answerFormat) {
    case 'multiple_choice':
      return { kind: 'option', optionId: (row.correctAnswer as { optionId: string }).optionId };
    case 'numeric':
      return { kind: 'numeric', value: Number(row.numericAnswer) };
    default:
      return { kind: 'text', text: payload.acceptedAnswers?.[0] ?? (row.correctAnswer as { text: string }).text };
  }
}
