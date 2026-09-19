import { DIFFICULTIES, QUIZ_MODES, ROUND_LENGTHS } from '@quiztape/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app';
import { RoundError, abandonRound, createRound, getResults, getRoundState, submitAnswer } from '../engine/round-service';
import { requireAuth } from '../middleware/require-auth';

const CreateBody = z.object({
  mode: z.enum(QUIZ_MODES),
  difficulty: z.enum(DIFFICULTIES),
  length: z.union([z.literal(ROUND_LENGTHS[0]), z.literal(ROUND_LENGTHS[1]), z.literal(ROUND_LENGTHS[2])]),
});

const AnswerBody = z.object({
  questionId: z.string().uuid(),
  responseMs: z.number().int().min(0).max(10 * 60 * 1000).nullable().default(null),
  submission: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string().max(200) }),
    z.object({ kind: z.literal('numeric'), value: z.number() }),
    z.object({ kind: z.literal('option'), optionId: z.string().max(32) }),
    z.object({ kind: z.literal('timeout') }),
    z.object({ kind: z.literal('skip') }),
  ]),
});

export const rounds = new Hono<AppEnv>();
rounds.use('*', requireAuth);

rounds.onError((error, c) => {
  if (error instanceof RoundError) return c.json({ error: error.code, message: error.message }, error.status);
  console.error(error);
  return c.json({ error: 'internal_error' }, 500);
});

rounds.post('/', async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const state = await createRound(c.get('services'), c.get('auth')!.userId, parsed.data);
  return c.json(state, 201);
});

rounds.get('/:roundId', async (c) => {
  return c.json(await getRoundState(c.get('services'), c.get('auth')!.userId, c.req.param('roundId')));
});

rounds.post('/:roundId/answers', async (c) => {
  const parsed = AnswerBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const result = await submitAnswer(c.get('services'), c.get('auth')!.userId, c.req.param('roundId'), parsed.data);
  return c.json(result);
});

rounds.get('/:roundId/results', async (c) => {
  return c.json(await getResults(c.get('services'), c.get('auth')!.userId, c.req.param('roundId')));
});

rounds.post('/:roundId/abandon', async (c) => {
  return c.json(await abandonRound(c.get('services'), c.get('auth')!.userId, c.req.param('roundId')));
});
