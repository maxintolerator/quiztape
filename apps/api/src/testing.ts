import { createTestDb } from '@quiztape/db/testing';
import { LastfmClient } from '@quiztape/lastfm';
import { MusicBrainzClient } from '@quiztape/musicbrainz';

import { deriveKey } from './lib/crypto';
import type { Services } from './services';

export type FakeFetch = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * Services backed by an in-process PGlite database and a scripted fetch, so
 * route and job tests run with nothing installed and never touch the network.
 */
export async function createTestServices(options: { fetch?: FakeFetch; now?: () => Date } = {}): Promise<Services> {
  const { db, close } = await createTestDb();
  const fetchImpl = (options.fetch ?? (() => new Response('{"error":8,"message":"no fake response"}', { status: 500 }))) as unknown as typeof fetch;
  const noRetry = { retries: 0 };
  return {
    db,
    lastfm: new LastfmClient({ apiKey: 'KEY', apiSecret: 'SECRET', fetch: fetchImpl, retry: noRetry }),
    musicbrainz: new MusicBrainzClient({ appName: 'QuiztapeTest', appVersion: '0', contact: 'test@example.com', fetch: fetchImpl, retry: noRetry }),
    sessionKeyKey: deriveKey('test-secret-test-secret-test-secret-1234', 'lastfm-session-key'),
    config: {
      apiBaseUrl: 'http://localhost:8787',
      lastfmCallbackUrl: 'http://localhost:8787/v1/auth/lastfm/callback',
      corsOrigins: ['http://localhost:8081'],
      allowedReturnOrigins: ['http://localhost:8081'],
      nativeScheme: 'quiztape',
      appSessionTtlMs: 90 * 24 * 60 * 60 * 1000,
    },
    now: options.now ?? (() => new Date()),
    close,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
