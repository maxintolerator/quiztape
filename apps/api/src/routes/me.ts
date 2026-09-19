import { schema } from '@quiztape/db';
import { DIFFICULTIES, type MeResponse, QUIZ_MODES, ROUND_LENGTHS, type UserSettingsDto } from '@quiztape/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app';
import { enqueueJob } from '../jobs/queue';
import { ensureUserRows, publicUser, syncSummary, triviaSummary } from '../lib/users';
import { requireAuth } from '../middleware/require-auth';

export const me = new Hono<AppEnv>();
me.use('*', requireAuth);

me.get('/', async (c) => {
  const services = c.get('services');
  const { user } = c.get('auth')!;
  const body: MeResponse = { user: publicUser(user), sync: await syncSummary(services, user.id) };
  return c.json(body);
});

/** Delete the account and everything owned by it (scrobbles, rollups, rounds, sessions) in one cascade. */
me.delete('/', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  await services.db.delete(schema.users).where(eq(schema.users.id, userId));
  return c.body(null, 204);
});

me.get('/sync', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  return c.json(await syncSummary(services, userId));
});

const REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

/** Pull new scrobbles since the last sync. Rate limited per user; the backfill must have completed. */
me.post('/sync/refresh', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  const [state] = await services.db.select().from(schema.userSyncState).where(eq(schema.userSyncState.userId, userId)).limit(1);
  if (!state || state.phase === 'pending' || state.phase === 'backfilling') {
    await ensureUserRows(services, userId);
    await enqueueJob(services, { kind: 'backfill', userId, dedupeKey: `backfill:${userId}`, priority: 5 });
    return c.json({ queued: 'backfill' });
  }
  const trivia = await triviaSummary(services, userId);
  if (!trivia.ready && !trivia.running && state.statsBuiltAt) {
    await enqueueJob(services, { kind: 'mb_ingest', userId, dedupeKey: `mb_ingest:${userId}`, priority: 2 });
  }
  const last = state.lastIncrementalAt?.getTime() ?? 0;
  if (services.now().getTime() - last < REFRESH_MIN_INTERVAL_MS) return c.json({ queued: null, reason: 'too_soon' });
  await enqueueJob(services, { kind: 'incremental', userId, dedupeKey: `incremental:${userId}`, priority: 8 });
  return c.json({ queued: 'incremental' });
});

me.get('/settings', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  await ensureUserRows(services, userId);
  const [row] = await services.db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).limit(1);
  return c.json(toDto(row!));
});

const SettingsPatch = z
  .object({
    geoOriginEnabled: z.boolean(),
    producerEnabled: z.boolean(),
    labelEnabled: z.boolean(),
    defaultMode: z.enum(QUIZ_MODES),
    defaultDifficulty: z.enum(DIFFICULTIES),
    defaultRoundLength: z.union(ROUND_LENGTHS.map((n) => z.literal(n)) as [z.ZodLiteral<5>, z.ZodLiteral<10>, z.ZodLiteral<20>]),
    timerSeconds: z.number().int().min(5).max(120),
    timezone: z.string().min(1).max(64),
    llmRephraseEnabled: z.boolean(),
  })
  .partial();

me.patch('/settings', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  const parsed = SettingsPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  await ensureUserRows(services, userId);
  const [row] = await services.db
    .update(schema.userSettings)
    .set({ ...parsed.data, updatedAt: services.now() })
    .where(eq(schema.userSettings.userId, userId))
    .returning();
  return c.json(toDto(row!));
});

function toDto(row: typeof schema.userSettings.$inferSelect): UserSettingsDto {
  return {
    geoOriginEnabled: row.geoOriginEnabled,
    producerEnabled: row.producerEnabled,
    labelEnabled: row.labelEnabled,
    defaultMode: row.defaultMode,
    defaultDifficulty: row.defaultDifficulty,
    defaultRoundLength: row.defaultRoundLength,
    timerSeconds: row.timerSeconds,
    timezone: row.timezone,
    llmRephraseEnabled: row.llmRephraseEnabled,
  };
}
