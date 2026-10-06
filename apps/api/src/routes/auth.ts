import { schema } from '@quiztape/db';
import { LASTFM_ERROR, LastfmApiError, type UserInfoResponse } from '@quiztape/lastfm';
import type { SignInResponse } from '@quiztape/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app';
import { randomToken, sha256Hex } from '../lib/crypto';
import { ensureUserRows, publicUser } from '../lib/users';
import { requireAuth } from '../middleware/require-auth';

/**
 * Sign-in is a Last.fm username, nothing more: everything Quiztape reads from
 * Last.fm is what the profile already shows without a login. The username is
 * checked with user.getInfo (which also gives its canonical spelling) and
 * swapped for the app's own bearer token.
 */
export const auth = new Hono<AppEnv>();

const SignInBody = z.object({
  username: z.string().trim().min(1).max(64),
  platform: z.enum(['web', 'ios', 'android']),
});

auth.post('/session', async (c) => {
  const services = c.get('services');
  const { db, lastfm, now } = services;
  const parsed = SignInBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', message: 'Enter a Last.fm username.' }, 400);
  const { username, platform } = parsed.data;

  let info: UserInfoResponse['user'];
  try {
    info = (await lastfm.getUserInfo(username, { priority: 10 })).user;
  } catch (error) {
    if (error instanceof LastfmApiError && error.code === LASTFM_ERROR.INVALID_PARAMETERS) {
      return c.json({ error: 'user_not_found', message: `Last.fm has no user called ${username}.` }, 404);
    }
    console.error(error);
    return c.json({ error: 'lastfm_unreachable', message: 'Last.fm did not answer. Try again in a minute.' }, 502);
  }

  const name = info.name || username;
  const registered = Number(info.registered?.unixtime);
  const profile = {
    lastfmUsername: name,
    realName: info.realname || null,
    country: info.country || null,
    lastfmRegisteredAt: Number.isFinite(registered) && registered > 0 ? new Date(registered * 1000) : null,
    lastfmReportedPlaycount: Number.isFinite(Number(info.playcount)) ? Number(info.playcount) : null,
  };
  const current = now();
  const [user] = await db
    .insert(schema.users)
    .values({ ...profile, lastfmUsernameKey: name.toLowerCase(), lastfmUrl: `https://www.last.fm/user/${encodeURIComponent(name)}`, lastSeenAt: current })
    .onConflictDoUpdate({ target: schema.users.lastfmUsernameKey, set: { ...profile, lastSeenAt: current, updatedAt: current, deletedAt: null } })
    .returning();
  if (!user) return c.json({ error: 'user_upsert_failed' }, 500);
  await ensureUserRows(services, user.id);

  const token = randomToken(32);
  await db.insert(schema.appSessions).values({
    userId: user.id,
    tokenHash: sha256Hex(token),
    platform,
    expiresAt: new Date(current.getTime() + services.config.appSessionTtlMs),
    lastSeenAt: current,
  });

  const body: SignInResponse = { token, user: publicUser(user) };
  return c.json(body);
});

auth.post('/logout', requireAuth, async (c) => {
  const { db, now } = c.get('services');
  const authCtx = c.get('auth')!;
  await db.update(schema.appSessions).set({ revokedAt: now() }).where(eq(schema.appSessions.id, authCtx.sessionId));
  return c.json({ ok: true });
});
