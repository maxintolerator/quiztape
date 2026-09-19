import { LastfmClient } from '@quiztape/lastfm';
import { MusicBrainzClient } from '@quiztape/musicbrainz';

import { loadEnv } from './env';

/**
 * Process-wide singletons. One limiter per upstream per process is the whole
 * point: every route and background job shares the same 5 req/s and 1 req/s budgets.
 */
let lastfm: LastfmClient | undefined;
let musicbrainz: MusicBrainzClient | undefined;

export function getLastfm(): LastfmClient {
  if (!lastfm) {
    const env = loadEnv();
    lastfm = new LastfmClient({
      apiKey: env.LASTFM_API_KEY,
      apiSecret: env.LASTFM_API_SECRET,
      userAgent: `${env.MUSICBRAINZ_APP_NAME}/${env.MUSICBRAINZ_APP_VERSION}`,
    });
  }
  return lastfm;
}

export function getMusicBrainz(): MusicBrainzClient {
  if (!musicbrainz) {
    const env = loadEnv();
    musicbrainz = new MusicBrainzClient({
      appName: env.MUSICBRAINZ_APP_NAME,
      appVersion: env.MUSICBRAINZ_APP_VERSION,
      contact: env.MUSICBRAINZ_CONTACT,
    });
  }
  return musicbrainz;
}
