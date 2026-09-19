import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { loadEnv, resetEnvCache } from './env';

describe('api app', () => {
  const app = createApp();

  it('answers health without any environment', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, service: 'quiztape-api' });
  });

  it('stubs unimplemented routes with 501 and the build step that delivers them', async () => {
    const res = await app.request('/v1/auth/lastfm/start');
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ error: 'not_implemented', step: 2 });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });

  it('sets CORS headers for the web client origin', async () => {
    const res = await app.request('/health', { headers: { Origin: 'http://localhost:8081' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
  });
});

describe('env', () => {
  it('rejects a missing Last.fm secret with a readable message', () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@localhost:5432/q',
        LASTFM_API_KEY: 'k',
        LASTFM_CALLBACK_URL: 'http://localhost:8787/cb',
        MUSICBRAINZ_CONTACT: 'dev@example.com',
      }),
    ).toThrow(/LASTFM_API_SECRET/);
    resetEnvCache();
  });

  it('parses CORS_ORIGINS into a list', () => {
    resetEnvCache();
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/q',
      LASTFM_API_KEY: 'k',
      LASTFM_API_SECRET: 's',
      LASTFM_CALLBACK_URL: 'http://localhost:8787/cb',
      MUSICBRAINZ_CONTACT: 'dev@example.com',
      CORS_ORIGINS: 'http://localhost:8081, https://quiztape.example',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081', 'https://quiztape.example']);
    resetEnvCache();
  });
});
