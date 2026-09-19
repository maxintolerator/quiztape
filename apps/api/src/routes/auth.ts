import { schema } from '@quiztape/db';
import { LastfmApiError } from '@quiztape/lastfm';
import type { ClientPlatform, ExchangeResponse } from '@quiztape/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app';
import { enqueueJob } from '../jobs/queue';
import { randomToken, seal, sha256Hex } from '../lib/crypto';
import { ensureUserRows, nameKey, publicUser } from '../lib/users';
import { requireAuth } from '../middleware/require-auth';
import type { Services } from '../services';

const FLOW_TTL_MS = 15 * 60 * 1000;
const EXCHANGE_TTL_MS = 5 * 60 * 1000;
const PLATFORMS: ClientPlatform[] = ['web', 'ios', 'android'];

/**
 * Last.fm web auth, all platforms:
 *   1. GET /lastfm/start      -> 302 to Last.fm with cb = our callback + state
 *   2. GET /lastfm/callback   -> exchange the 60-minute token for a session key,
 *                               upsert the user, queue the backfill, 302 to the
 *                               client's return URL with a one-time ?code=
 *   3. POST /exchange {code}  -> bearer token for the client to store
 */
export const auth = new Hono<AppEnv>();

auth.get('/lastfm/start', async (c) => {
  const services = c.get('services');
  const platform = c.req.query('platform') ?? 'web';
  if (!PLATFORMS.includes(platform as ClientPlatform)) return c.json({ error: 'invalid_platform' }, 400);

  const returnTo = resolveReturnTo(services, platform as ClientPlatform, c.req.query('return_to'));
  if (!returnTo) return c.json({ error: 'invalid_return_to', message: 'return_to must be an allowed web origin or the app scheme' }, 400);

  const state = randomToken(24);
  const now = services.now();
  await services.db.insert(schema.authFlows).values({
    state,
    platform: platform as ClientPlatform,
    returnTo,
    expiresAt: new Date(now.getTime() + FLOW_TTL_MS),
  });

  const callback = new URL(services.config.lastfmCallbackUrl);
  callback.searchParams.set('state', state);
  return c.redirect(services.lastfm.authUrl(callback.toString()), 302);
});

auth.get('/lastfm/callback', async (c) => {
  const services = c.get('services');
  const { db, lastfm, now } = services;
  const state = c.req.query('state');
  const token = c.req.query('token');
  if (!state) return c.html(errorPage('This sign-in link is missing its state. Start again from the app.'), 400);

  const [flow] = await db.select().from(schema.authFlows).where(eq(schema.authFlows.state, state)).limit(1);
  if (!flow) return c.html(errorPage('This sign-in link is unknown or has been used. Start again from the app.'), 400);
  const current = now();
  if (flow.expiresAt.getTime() <= current.getTime()) return c.redirect(withParam(flow.returnTo, 'error', 'expired'), 302);
  if (flow.consumedAt) return c.redirect(withParam(flow.returnTo, 'error', 'already_used'), 302);
  if (!token) return c.redirect(withParam(flow.returnTo, 'error', 'denied'), 302);

  // Claim the token before exchanging it: a replay of the same callback must not reach Last.fm twice.
  const claimed = await db
    .update(schema.authFlows)
    .set({ lastfmTokenHash: sha256Hex(token) })
    .where(and(eq(schema.authFlows.id, flow.id), isNull(schema.authFlows.lastfmTokenHash)))
    .returning({ id: schema.authFlows.id })
    .catch(() => []);
  if (claimed.length === 0) return c.redirect(withParam(flow.returnTo, 'error', 'already_used'), 302);

  let session: { name: string; key: string; subscriber: number | string };
  try {
    session = await lastfm.getSession(token, { priority: 10 });
  } catch (error) {
    const code = error instanceof LastfmApiError ? error.code : 0;
    await db.update(schema.authFlows).set({ lastfmErrorCode: code, consumedAt: current }).where(eq(schema.authFlows.id, flow.id));
    return c.redirect(withParam(flow.returnTo, 'error', code ? `lastfm_${code}` : 'lastfm_unreachable'), 302);
  }

  // Upsert the user by case-insensitive username.
  const [user] = await db
    .insert(schema.users)
    .values({
      lastfmUsername: session.name,
      lastfmUsernameKey: session.name.toLowerCase(),
      lastfmUrl: `https://www.last.fm/user/${encodeURIComponent(session.name)}`,
      lastSeenAt: current,
    })
    .onConflictDoUpdate({
      target: schema.users.lastfmUsernameKey,
      set: { lastfmUsername: session.name, lastSeenAt: current, updatedAt: current, deletedAt: null },
    })
    .returning();
  if (!user) return c.redirect(withParam(flow.returnTo, 'error', 'user_upsert_failed'), 302);

  // Profile details are nice to have; never fail the sign-in over them.
  try {
    const info = (await lastfm.getUserInfo(session.name, { priority: 10 })).user;
    const registered = Number(info.registered?.unixtime);
    await db
      .update(schema.users)
      .set({
        realName: info.realname || null,
        country: info.country || null,
        lastfmRegisteredAt: Number.isFinite(registered) && registered > 0 ? new Date(registered * 1000) : null,
        lastfmReportedPlaycount: Number.isFinite(Number(info.playcount)) ? Number(info.playcount) : null,
      })
      .where(eq(schema.users.id, user.id));
  } catch {
    // ignore
  }

  // One active Last.fm session per user: revoke the previous one, seal the new key.
  await db
    .update(schema.lastfmSessions)
    .set({ status: 'revoked', revokedAt: current, revokedReason: 'reconnected' })
    .where(and(eq(schema.lastfmSessions.userId, user.id), eq(schema.lastfmSessions.status, 'active')));
  await db.insert(schema.lastfmSessions).values({
    userId: user.id,
    sessionKeyCiphertext: seal(session.key, services.sessionKeyKey),
    subscriber: String(session.subscriber) === '1',
  });

  await ensureUserRows(services, user.id);
  await enqueueJob(services, { kind: 'backfill', userId: user.id, dedupeKey: `backfill:${user.id}`, priority: 5 });

  const code = randomToken(24);
  await db
    .update(schema.authFlows)
    .set({
      userId: user.id,
      consumedAt: current,
      exchangeCodeHash: sha256Hex(code),
      exchangeExpiresAt: new Date(current.getTime() + EXCHANGE_TTL_MS),
    })
    .where(eq(schema.authFlows.id, flow.id));

  return c.redirect(withParam(flow.returnTo, 'code', code), 302);
});

const ExchangeBody = z.object({ code: z.string().min(16).max(256) });

auth.post('/exchange', async (c) => {
  const services = c.get('services');
  const { db, now } = services;
  const parsed = ExchangeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);

  const current = now();
  const [flow] = await db
    .select()
    .from(schema.authFlows)
    .where(eq(schema.authFlows.exchangeCodeHash, sha256Hex(parsed.data.code)))
    .limit(1);
  if (!flow || !flow.userId || flow.exchangedAt || !flow.exchangeExpiresAt || flow.exchangeExpiresAt.getTime() <= current.getTime()) {
    return c.json({ error: 'invalid_code' }, 400);
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, flow.userId)).limit(1);
  if (!user || user.deletedAt) return c.json({ error: 'invalid_code' }, 400);

  const token = randomToken(32);
  const [appSession] = await db
    .insert(schema.appSessions)
    .values({
      userId: user.id,
      tokenHash: sha256Hex(token),
      platform: flow.platform,
      expiresAt: new Date(current.getTime() + services.config.appSessionTtlMs),
      lastSeenAt: current,
    })
    .returning({ id: schema.appSessions.id });
  await db
    .update(schema.authFlows)
    .set({ exchangedAt: current, appSessionId: appSession?.id ?? null })
    .where(eq(schema.authFlows.id, flow.id));

  const body: ExchangeResponse = { token, user: publicUser(user) };
  return c.json(body);
});

auth.post('/logout', requireAuth, async (c) => {
  const { db, now } = c.get('services');
  const authCtx = c.get('auth')!;
  await db.update(schema.appSessions).set({ revokedAt: now() }).where(eq(schema.appSessions.id, authCtx.sessionId));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ helpers

function resolveReturnTo(services: Services, platform: ClientPlatform, requested: string | undefined): string | null {
  const { allowedReturnOrigins, nativeScheme } = services.config;
  if (platform === 'web') {
    const fallback = allowedReturnOrigins[0] ? `${allowedReturnOrigins[0]}/auth/callback` : null;
    if (!requested) return fallback;
    try {
      const url = new URL(requested);
      return allowedReturnOrigins.includes(url.origin) ? url.toString() : null;
    } catch {
      return null;
    }
  }
  const fallback = `${nativeScheme}://auth/callback`;
  if (!requested) return fallback;
  return requested.startsWith(`${nativeScheme}://`) ? requested : null;
}

/** Append a query parameter to an http(s) or custom-scheme URL. */
export function withParam(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Quiztape</title><body style="font-family:system-ui;background:#0B0B10;color:#F3E9D2;display:grid;place-items:center;height:100vh;margin:0"><main style="max-width:32rem;padding:2rem;text-align:center"><h1 style="letter-spacing:.2em">QUIZTAPE</h1><p>${message}</p></main></body>`;
}
