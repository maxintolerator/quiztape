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

  it('protects every game route with the bearer session', async () => {
    expect((await app.request('/v1/rounds', { method: 'POST' })).status).toBe(401);
  });

  it('no longer serves the bracket or the Last.fm redirect sign-in', async () => {
    expect((await app.request('/v1/brackets', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/v1/auth/lastfm/start?platform=web')).status).toBe(404);
    expect((await app.request('/v1/auth/exchange', { method: 'POST' })).status).toBe(404);
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

describe('sign-in by Last.fm username', () => {
  let token: string;
  const signIn = (body: unknown) => app.request('/v1/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('checks the username with Last.fm, keeps its canonical spelling and hands out a bearer token', async () => {
    const res = await signIn({ username: '  SomeOne ', platform: 'web' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { lastfmUsername: string; lastfmUrl: string; realName: string } };
    expect(body.user).toMatchObject({ lastfmUsername: 'someone', lastfmUrl: 'https://www.last.fm/user/someone', realName: 'Some One' });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    token = body.token;
    const lookup = fake.state.calls.find((u) => u.searchParams.get('method') === 'user.getInfo');
    expect(lookup?.searchParams.get('user')).toBe('SomeOne');
  });

  it('stores the profile and no Last.fm credentials, and queues nothing: the history is the device\'s job', async () => {
    const [user] = await services.db.select().from(schema.users).where(eq(schema.users.lastfmUsernameKey, 'someone'));
    expect(user).toMatchObject({ realName: 'Some One', country: 'DE', lastfmReportedPlaycount: 1 });
    const sessions = await services.db.select().from(schema.appSessions).where(eq(schema.appSessions.userId, user!.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
    const jobs = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.userId, user!.id));
    expect(jobs).toEqual([]);
  });

  it('says so when Last.fm has no such user, and when Last.fm is down', async () => {
    const missing = await signIn({ username: 'nobody', platform: 'ios' });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: 'user_not_found', message: 'Last.fm has no user called nobody.' });

    fake.state.userInfoError = 11;
    const down = await signIn({ username: 'someone', platform: 'web' });
    fake.state.userInfoError = null;
    expect(down.status).toBe(502);
    await expect(down.json()).resolves.toMatchObject({ error: 'lastfm_unreachable' });
  });

  it('refuses a blank username or an unknown platform without asking Last.fm', async () => {
    const before = fake.state.calls.length;
    expect((await signIn({ username: '   ', platform: 'web' })).status).toBe(400);
    expect((await signIn({ username: 'someone', platform: 'tv' })).status).toBe(400);
    expect((await signIn(null)).status).toBe(400);
    expect(fake.state.calls.length).toBe(before);
  });

  it('serves /v1/me with the bearer token and revokes it on logout', async () => {
    const me = await app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toEqual({ user: expect.objectContaining({ lastfmUsername: 'someone' }), lastfm: { apiKey: 'KEY' } });

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

  it('signs the same username into the same account from another device', async () => {
    const [before] = await services.db.select().from(schema.users).where(eq(schema.users.lastfmUsernameKey, 'someone'));
    const res = await signIn({ username: 'someone', platform: 'android' });
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe(before!.id);
    expect(await services.db.select().from(schema.users).where(eq(schema.users.lastfmUsernameKey, 'someone'))).toHaveLength(1);
  });

  it('deletes the account and everything it owns', async () => {
    const signedIn = (await (await signIn({ username: 'someone', platform: 'web' })).json()) as { token: string };
    const del = await app.request('/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${signedIn.token}` } });
    expect(del.status).toBe(204);
    expect((await app.request('/v1/me', { headers: { authorization: `Bearer ${signedIn.token}` } })).status).toBe(401);
    const users = await services.db.select().from(schema.users).where(eq(schema.users.lastfmUsernameKey, 'someone'));
    expect(users).toHaveLength(0);
    expect(await services.db.select().from(schema.appSessions)).toEqual([]);
    const jobs = await services.db.select().from(schema.syncJobs);
    expect(jobs.every((j) => j.userId === null)).toBe(true);
  });
});

describe('env', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/q',
    LASTFM_API_KEY: 'k',
    MUSICBRAINZ_CONTACT: 'dev@example.com',
  };

  it('needs only the Last.fm API key, not the secret, a callback URL or a session secret', () => {
    resetEnvCache();
    expect(loadEnv(base).LASTFM_API_SECRET).toBeUndefined();
    resetEnvCache();
    expect(() => loadEnv({ ...base, LASTFM_API_KEY: '' })).toThrow(/LASTFM_API_KEY/);
    resetEnvCache();
  });

  it('parses CORS_ORIGINS into a list and WORKER_ENABLED into a boolean', () => {
    resetEnvCache();
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://localhost:8081, https://quiztape.example', WORKER_ENABLED: 'false' });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081', 'https://quiztape.example']);
    expect(env.WORKER_ENABLED).toBe(false);
    resetEnvCache();
  });
});
