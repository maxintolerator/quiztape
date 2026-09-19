import { type Db, createDb } from '@quiztape/db';
import { LastfmClient } from '@quiztape/lastfm';
import { MusicBrainzClient } from '@quiztape/musicbrainz';

import { type Env, loadEnv } from './env';
import { deriveKey } from './lib/crypto';

/**
 * Everything a route or job needs, built once per process and injectable in
 * tests (PGlite database, fake Last.fm). Routes read it from `c.get('services')`.
 */
export interface Services {
  db: Db;
  lastfm: LastfmClient;
  musicbrainz: MusicBrainzClient;
  /** Key that seals Last.fm session keys at rest. */
  sessionKeyKey: Buffer;
  config: {
    apiBaseUrl: string;
    lastfmCallbackUrl: string;
    corsOrigins: string[];
    /** Return targets the auth flow may redirect to: web origins and the native scheme. */
    allowedReturnOrigins: string[];
    nativeScheme: string;
    appSessionTtlMs: number;
  };
  now: () => Date;
  close: () => Promise<void>;
}

export function createServices(env: Env = loadEnv()): Services {
  const { db, close } = createDb(env.DATABASE_URL);
  const callback = new URL(env.LASTFM_CALLBACK_URL);
  const apiBaseUrl = `${callback.protocol}//${callback.host}`;
  const secret = env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return {
    db,
    lastfm: new LastfmClient({
      apiKey: env.LASTFM_API_KEY,
      apiSecret: env.LASTFM_API_SECRET,
      userAgent: `${env.MUSICBRAINZ_APP_NAME}/${env.MUSICBRAINZ_APP_VERSION} ( ${env.MUSICBRAINZ_CONTACT} )`,
    }),
    musicbrainz: new MusicBrainzClient({
      appName: env.MUSICBRAINZ_APP_NAME,
      appVersion: env.MUSICBRAINZ_APP_VERSION,
      contact: env.MUSICBRAINZ_CONTACT,
    }),
    sessionKeyKey: deriveKey(secret, 'lastfm-session-key'),
    config: {
      apiBaseUrl,
      lastfmCallbackUrl: env.LASTFM_CALLBACK_URL,
      corsOrigins: env.CORS_ORIGINS,
      allowedReturnOrigins: env.CORS_ORIGINS,
      nativeScheme: 'quiztape',
      appSessionTtlMs: 90 * 24 * 60 * 60 * 1000,
    },
    now: () => new Date(),
    close,
  };
}
