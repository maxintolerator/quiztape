import { type LocalScrobble, type RawRecentTrack, scrobbleFromRecentTrack } from './library';

/**
 * Reading a listening history straight from Last.fm, on the player's device.
 * `user.getRecentTracks` is a public method: it needs the app's API key (an
 * identifier, not the secret) and nothing else, so each device spends its own
 * Last.fm allowance instead of queueing behind every other player on a server.
 */
export const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
export const HISTORY_PAGE_SIZE = 200;

/** Last.fm error codes worth another try: backend hiccups (8, 11, 16) and rate limiting (29). */
const RETRYABLE_CODES = new Set([8, 11, 16, 29]);
const RATE_LIMITED = 29;

export class LastfmHistoryError extends Error {
  constructor(
    /** Last.fm's error code, or null when the failure was transport-level. */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'LastfmHistoryError';
  }

  /** "Hide recent listening information" is switched on in the account's Last.fm privacy settings. */
  get privacyBlocked(): boolean {
    return this.code === 17;
  }
}

export interface HistoryPageRequest {
  apiKey: string;
  username: string;
  /** 1-based; page 1 holds the newest plays. */
  page: number;
  /** Unix seconds, both optional. */
  from?: number | undefined;
  to?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface HistoryPage {
  scrobbles: LocalScrobble[];
  totalPages: number;
}

export interface HistoryFetchDeps {
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  /** Tries per page before giving up. */
  attempts?: number | undefined;
}

/** Resolves after `ms`, or rejects as soon as the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface RecentTracksBody {
  error?: number;
  message?: string;
  recenttracks?: { track?: RawRecentTrack[] | RawRecentTrack; '@attr'?: { totalPages?: string } };
}

/** One page of plays. Retries transient failures with back-off; a privacy block or an unknown user fails at once. */
export async function fetchHistoryPage(request: HistoryPageRequest, deps: HistoryFetchDeps = {}): Promise<HistoryPage> {
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.sleep ?? sleep;
  const attempts = deps.attempts ?? 5;
  const params: Record<string, string | number | undefined> = {
    method: 'user.getrecenttracks',
    user: request.username,
    api_key: request.apiKey,
    format: 'json',
    limit: HISTORY_PAGE_SIZE,
    page: request.page,
    from: request.from,
    to: request.to,
  };
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  for (let attempt = 1; ; attempt++) {
    if (request.signal?.aborted) throw new Error('aborted');
    let failure: LastfmHistoryError;
    let retryable = true;
    try {
      const init: RequestInit = request.signal ? { signal: request.signal } : {};
      const response = await doFetch(`${LASTFM_API_URL}?${query}`, init);
      const body = (await response.json().catch(() => null)) as RecentTracksBody | null;
      if (body && typeof body.error === 'number') {
        failure = new LastfmHistoryError(body.error, body.message ?? `Last.fm error ${body.error}`);
        retryable = RETRYABLE_CODES.has(body.error);
      } else if (!response.ok || !body?.recenttracks) {
        failure = new LastfmHistoryError(null, `Last.fm answered ${response.status}`);
        retryable = response.status >= 500 || response.status === 429 || response.ok;
      } else {
        const rows = body.recenttracks.track;
        const tracks = rows === undefined ? [] : Array.isArray(rows) ? rows : [rows];
        return {
          scrobbles: tracks.map(scrobbleFromRecentTrack).filter((row): row is LocalScrobble => row !== null),
          totalPages: Number(body.recenttracks['@attr']?.totalPages) || 0,
        };
      }
    } catch (error) {
      if (request.signal?.aborted) throw new Error('aborted');
      failure = new LastfmHistoryError(null, error instanceof Error ? error.message : 'Network error');
    }
    if (!retryable || attempt >= attempts) throw failure;
    await wait((failure.code === RATE_LIMITED ? 5_000 : 1_000) * 2 ** (attempt - 1), request.signal);
  }
}
