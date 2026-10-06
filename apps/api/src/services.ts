import { type Db, createDb } from '@quiztape/db';
import { LastfmClient } from '@quiztape/lastfm';
import { MusicBrainzClient } from '@quiztape/musicbrainz';

import { type Env, loadEnv } from './env';

/**
 * Everything a route or job needs, built once per process and injectable in
 * tests (PGlite database, fake Last.fm). Routes read it from `c.get('services')`.
 */
export interface Services {
  db: Db;
  lastfm: LastfmClient;
  musicbrainz: MusicBrainzClient;
  config: {
    /** Handed to signed-in clients so the device can read the player's history itself. An identifier, not the secret. */
    lastfmApiKey: string;
    corsOrigins: string[];
    appSessionTtlMs: number;
  };
  now: () => Date;
  close: () => Promise<void>;
}

export function createServices(env: Env = loadEnv()): Services {
  const { db, close } = createDb(env.DATABASE_URL);
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
    config: {
      lastfmApiKey: env.LASTFM_API_KEY,
      corsOrigins: env.CORS_ORIGINS,
      appSessionTtlMs: 90 * 24 * 60 * 60 * 1000,
    },
    now: () => new Date(),
    close,
  };
}
