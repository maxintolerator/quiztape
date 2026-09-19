import { schema } from '@quiztape/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { loadEnv, resetEnvCache } from './env';
import { createFakeLastfm, track } from './fake-lastfm';
import type { Services } from './services';
import { createTestServices } from './testing';

let services: Services;
let app: ReturnType<typeof createApp>;
const fake = createFakeLastfm({ history: [track(1_700_000_000, 'Boards of Canada', 'Roygbiv', 'Music Has the Right to Children')] });

beforeAll(async () => {
  services = await createTestServices({ fetch: fake.fetch });
  app = createApp(services);
}, 120_000);

afterAll(async () => {
  await services?.close();
});

describe('api basics', () => {
  it('answers health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, service: 'quiztape-api' });
  });

  it('stubs unimplemented routes with 501 and the build step that delivers them', async () => {
    const res = await app.request('/v1/brackets', { method: 'POST' });
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ error: 'not_implemented', step: 6 });
  });

  it('returns JSON 404 for unknown routes and 401 without a token', async () => {
    expect((await app.request('/nope')).status).toBe(404);
    expect((await app.request('/v1/me')).status).toBe(401);
    expect((await app.request('/v1/me', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('sets CORS headers for the web client origin', async () => {
    const res = await app.request('/health', { headers: { Origin: 'http://localhost:8081' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
  });
});

describe('Last.fm web auth flow', () => {
  let code: string;
  let token: string;

  it('start redirects to Last.fm with our callback and a state', async () => {
    const res = await app.request('/v1/auth/lastfm/start?platform=web&return_to=http%3A%2F%2Flocalhost%3A8081%2Fauth%2Fcallback');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://www.last.fm/api/auth/');
    expect(location.searchParams.get('api_key')).toBe('KEY');
    const cb = new URL(location.searchParams.get('cb')!);
    expect(cb.origin + cb.pathname).toBe('http://localhost:8787/v1/auth/lastfm/callback');
    expect(cb.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // Callback: Last.fm appends &token= to our cb URL.
    const callback = await app.request(`/v1/auth/lastfm/callback?state=${cb.searchParams.get('state')}&token=TOKEN1`);
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get('location')!);
    expect(back.origin + back.pathname).toBe('http://localhost:8081/auth/callback');
    code = back.searchParams.get('code')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // Replaying the callback cannot mint another code or hit Last.fm again.
    const replay = await app.request(`/v1/auth/lastfm/callback?state=${cb.searchParams.get('state')}&token=TOKEN1`);
    expect(new URL(replay.headers.get('location')!).searchParams.get('error')).toBe('already_used');
    expect(fake.state.calls.filter((u) => u.searchParams.get('method') === 'auth.getSession')).toHaveLength(1);
  });

  it('rejects return_to outside the allowed origins and unknown platforms', async () => {
    expect((await app.request('/v1/auth/lastfm/start?platform=web&return_to=https%3A%2F%2Fevil.example%2Fcb')).status).toBe(400);
    expect((await app.request('/v1/auth/lastfm/start?platform=tv')).status).toBe(400);
    const native = await app.request('/v1/auth/lastfm/start?platform=ios');
    expect(native.status).toBe(302);
  });

  it('exchanges the one-time code for a bearer token, exactly once', async () => {
    const res = await app.request('/v1/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { lastfmUsername: string } };
    expect(body.user.lastfmUsername).toBe('someone');
    token = body.token;

    const again = await app.request('/v1/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(again.status).toBe(400);
  });

  it('stores the Last.fm session key encrypted and queues a backfill', async () => {
    const [user] = await services.db.select().from(schema.users).where(eq(schema.users.lastfmUsernameKey, 'someone'));
    expect(user?.realName).toBe('Some One');
    const sessions = await services.db.select().from(schema.lastfmSessions).where(eq(schema.lastfmSessions.userId, user!.id));
    expect(sessions).toHaveLength(1);
    expect(Buffer.from(sessions[0]!.sessionKeyCiphertext).toString('utf8')).not.toContain('a'.repeat(32));
    const jobs = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.userId, user!.id));
    expect(jobs.map((j) => j.kind)).toEqual(['backfill']);
  });

  it('serves /v1/me with the bearer token and revokes it on logout', async () => {
    const me = await app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ user: { lastfmUsername: 'someone' }, sync: { phase: 'pending' } });

    const settings = await app.request('/v1/me/settings', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ geoOriginEnabled: true, defaultRoundLength: 20 }),
    });
    await expect(settings.json()).resolves.toMatchObject({ geoOriginEnabled: true, defaultRoundLength: 20, producerEnabled: false });

    const logout = await app.request('/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(logout.status).toBe(200);
    expect((await app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('reports a Last.fm token failure back to the client instead of a 500', async () => {
    const start = await app.request('/v1/auth/lastfm/start?platform=web');
    const state = new URL(new URL(start.headers.get('location')!).searchParams.get('cb')!).searchParams.get('state');
    const callback = await app.request(`/v1/auth/lastfm/callback?state=${state}&token=BAD`);
    expect(new URL(callback.headers.get('location')!).searchParams.get('error')).toBe('lastfm_14');
  });
});

describe('env', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/q',
    LASTFM_API_KEY: 'k',
    LASTFM_CALLBACK_URL: 'http://localhost:8787/cb',
    MUSICBRAINZ_CONTACT: 'dev@example.com',
    SESSION_SECRET: 's'.repeat(40),
  };

  it('rejects a missing Last.fm secret with a readable message', () => {
    resetEnvCache();
    expect(() => loadEnv(base)).toThrow(/LASTFM_API_SECRET/);
    resetEnvCache();
  });

  it('parses CORS_ORIGINS into a list and WORKER_ENABLED into a boolean', () => {
    resetEnvCache();
    const env = loadEnv({ ...base, LASTFM_API_SECRET: 's', CORS_ORIGINS: 'http://localhost:8081, https://quiztape.example', WORKER_ENABLED: 'false' });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081', 'https://quiztape.example']);
    expect(env.WORKER_ENABLED).toBe(false);
    resetEnvCache();
  });
});
