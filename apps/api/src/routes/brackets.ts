import { BRACKET_SIZES } from '@quiztape/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app';
import { answerDuel, createBracket, getBracketState, pickWinner } from '../engine/bracket-service';
import { RoundError } from '../engine/round-service';
import { requireAuth } from '../middleware/require-auth';

const CreateBody = z.object({ size: z.union([z.literal(BRACKET_SIZES[0]), z.literal(BRACKET_SIZES[1]), z.literal(BRACKET_SIZES[2])]).default(16) });
const SeedBody = z.object({ seed: z.number().int().min(1).max(64) });

export const brackets = new Hono<AppEnv>();
brackets.use('*', requireAuth);
brackets.onError((error, c) => {
  if (error instanceof RoundError) return c.json({ error: error.code, message: error.message }, error.status);
  console.error(error);
  return c.json({ error: 'internal_error' }, 500);
});

brackets.post('/', async (c) => {
  const parsed = CreateBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  return c.json(await createBracket(c.get('services'), c.get('auth')!.userId, parsed.data.size), 201);
});

brackets.get('/:bracketId', async (c) => c.json(await getBracketState(c.get('services'), c.get('auth')!.userId, c.req.param('bracketId'))));

brackets.post('/:bracketId/matches/:matchId/duel', async (c) => {
  const parsed = SeedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  return c.json(await answerDuel(c.get('services'), c.get('auth')!.userId, c.req.param('bracketId'), c.req.param('matchId'), parsed.data.seed));
});

brackets.post('/:bracketId/matches/:matchId/pick', async (c) => {
  const parsed = SeedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  return c.json(await pickWinner(c.get('services'), c.get('auth')!.userId, c.req.param('bracketId'), c.req.param('matchId'), parsed.data.seed));
});
