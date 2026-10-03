import { schema } from '@quiztape/db';
import { DIFFICULTIES, type MeResponse, QUIZ_MODES, ROUND_LENGTHS, SNAPSHOT_MAX_ARTISTS, TRIVIA_ARTIST_CAP, type UserSettingsDto, nameKey } from '@quiztape/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app';
import { enqueueJob } from '../jobs/queue';
import { ensureUserRows, publicUser, triviaSummary } from '../lib/users';
import { requireAuth } from '../middleware/require-auth';

export const me = new Hono<AppEnv>();
me.use('*', requireAuth);

me.get('/', async (c) => {
  const services = c.get('services');
  const { user } = c.get('auth')!;
  const body: MeResponse = { user: publicUser(user), lastfm: { apiKey: services.config.lastfmApiKey } };
  return c.json(body);
});

/** Delete the account and everything owned by it (rounds, brackets, settings, sessions) in one cascade. The listening history is on the device; the client clears it. */
me.delete('/', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  await services.db.delete(schema.users).where(eq(schema.users.id, userId));
  return c.body(null, 204);
});

const ANNOUNCE_MIN_INTERVAL_MS = 10 * 60 * 1000;

const AnnounceBody = z.object({
  artists: z
    .array(z.object({ name: z.string().min(1).max(300), rank: z.number().int().min(1).max(SNAPSHOT_MAX_ARTISTS), mbidHint: z.string().uuid().nullable() }))
    .max(TRIVIA_ARTIST_CAP),
});

/**
 * The device announces the player's most played artists after a sync so band
 * facts can be fetched for them. Nothing about the library is stored beyond
 * the queued jobs. Rate limited per user; returns the readiness either way.
 */
me.post('/library', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  const parsed = AnnounceBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const { artists } = parsed.data;
  const [last] = await services.db
    .select({ createdAt: schema.syncJobs.createdAt })
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.userId, userId), eq(schema.syncJobs.dedupeKey, `mb_ingest:${userId}`)))
    .orderBy(desc(schema.syncJobs.createdAt))
    .limit(1);
  const tooSoon = !!last && services.now().getTime() - last.createdAt.getTime() < ANNOUNCE_MIN_INTERVAL_MS;
  if (artists.length > 0 && !tooSoon) {
    await enqueueJob(services, { kind: 'mb_ingest', userId, dedupeKey: `mb_ingest:${userId}`, priority: 2, payload: { artists } });
  }
  return c.json(await triviaSummary(services, userId, artists.map((a) => nameKey(a.name))));
});

const TriviaBody = z.object({ artistKeys: z.array(z.string().min(1).max(300)).max(SNAPSHOT_MAX_ARTISTS) });

/** Side B readiness for the artists the device names. Read-only; the client polls it while band facts load. */
me.post('/trivia', async (c) => {
  const services = c.get('services');
  const { userId } = c.get('auth')!;
  const parsed = TriviaBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  return c.json(await triviaSummary(services, userId, parsed.data.artistKeys.map(nameKey)));
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
