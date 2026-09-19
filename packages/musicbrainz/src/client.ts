import {
  type Clock,
  HttpError,
  RateLimiter,
  type RetryOptions,
  parseRetryAfter,
  systemClock,
  withRetry,
} from '@quiztape/ratelimit';

import { MB_MAX_LIMIT, MUSICBRAINZ_API_URL } from './constants';
import { MusicBrainzBadRequestError, MusicBrainzError, MusicBrainzNotFoundError } from './errors';
import { fieldQuery } from './lucene';
import type {
  Artist,
  ArtistInc,
  ArtistSearchResponse,
  Recording,
  RecordingInc,
  Release,
  ReleaseBrowseResponse,
  ReleaseGroup,
  ReleaseGroupBrowseResponse,
  ReleaseGroupInc,
  ReleaseGroupTypeFilter,
  ReleaseInc,
  ReleaseStatus,
} from './types';

export interface MusicBrainzClientOptions {
  /** Used to build the mandatory User-Agent: `AppName/Version ( contact )`. */
  appName: string;
  appVersion: string;
  /** Email or URL. MusicBrainz throttles or blocks clients without a real contact. */
  contact: string;
  fetch?: typeof globalThis.fetch | undefined;
  /** Share one limiter per process: the 1 req/s budget is per source IP. */
  limiter?: RateLimiter | undefined;
  baseUrl?: string | undefined;
  retry?: RetryOptions | undefined;
  clock?: Clock | undefined;
  onRetry?: ((error: unknown, attempt: number, delayMs: number) => void) | undefined;
}

export interface CallOptions {
  /** Higher runs first. Interactive lookups should outrank background ingestion. */
  priority?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface PageOptions extends CallOptions {
  /** 1..100. */
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SearchOptions extends PageOptions {
  /** Escape special characters and search plain text instead of Lucene syntax. */
  dismax?: boolean | undefined;
}

export interface BrowseReleaseGroupsOptions extends PageOptions {
  /** e.g. 'album', 'album|ep', 'album|compilation'. Omit for all. */
  type?: ReleaseGroupTypeFilter | undefined;
  inc?: ReleaseGroupInc[] | undefined;
}

export interface BrowseReleasesOptions extends PageOptions {
  releaseGroup?: string | undefined;
  artist?: string | undefined;
  status?: Lowercase<ReleaseStatus> | undefined;
  inc?: ReleaseInc[] | undefined;
}

/**
 * Typed MusicBrainz client. Every request passes through a strict 1 req/s
 * queue (burst 1, concurrency 1) and retries 503s while pausing the queue for
 * the upstream's Retry-After, so parallel callers never trip the limit.
 */
export class MusicBrainzClient {
  readonly limiter: RateLimiter;
  readonly userAgent: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly retry: RetryOptions;
  private readonly clock: Clock;
  private readonly onRetry: MusicBrainzClientOptions['onRetry'];

  constructor(options: MusicBrainzClientOptions) {
    if (!options.appName || !options.appVersion || !options.contact) {
      throw new Error('MusicBrainzClient: appName, appVersion and contact are required for the User-Agent');
    }
    this.userAgent = `${options.appName}/${options.appVersion} ( ${options.contact} )`;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? MUSICBRAINZ_API_URL;
    // MusicBrainz documents no Retry-After on 503; a full second is the smallest sensible back-off.
    this.retry = { baseDelayMs: 1_000, ...options.retry };
    this.clock = options.clock ?? systemClock;
    this.onRetry = options.onRetry;
    this.limiter =
      options.limiter ??
      new RateLimiter({ name: 'musicbrainz', requestsPerSecond: 1, burst: 1, concurrency: 1, clock: this.clock });
  }

  // ------------------------------------------------------------- artists

  /**
   * Lookup by MBID. Returns null on 404 (unknown or deleted MBID, safe to
   * negative-cache). A merged MBID answers 301 with the canonical entity: fetch
   * follows it, so compare `result.id` with `mbid` and record a redirect when
   * they differ. Sub-lists on lookups (`inc=releases` etc.) are capped at 25;
   * use the browse methods for complete lists.
   */
  lookupArtist(mbid: string, inc: ArtistInc[] = [], options: CallOptions = {}): Promise<Artist | null> {
    return this.lookup<Artist>(`artist/${mbid}`, inc, options);
  }

  /**
   * Full-text artist search. `query` is raw Lucene unless `dismax` is set; use
   * `searchArtistsByName` for a plain name. Scores are relative: the top hit for a
   * bare name may be a homonym, so callers disambiguate by type, country and dates.
   */
  searchArtists(query: string, options: SearchOptions = {}): Promise<ArtistSearchResponse> {
    return this.get<ArtistSearchResponse>(
      'artist',
      { query, dismax: options.dismax ? 'true' : undefined, ...pageParams(options) },
      options,
    );
  }

  searchArtistsByName(name: string, options: SearchOptions = {}): Promise<ArtistSearchResponse> {
    return this.searchArtists(fieldQuery('artist', name), options);
  }

  // ------------------------------------------------------- release groups

  lookupReleaseGroup(mbid: string, inc: ReleaseGroupInc[] = [], options: CallOptions = {}): Promise<ReleaseGroup | null> {
    return this.lookup<ReleaseGroup>(`release-group/${mbid}`, inc, options);
  }

  /** One page of an artist's release groups. */
  browseReleaseGroups(artistMbid: string, options: BrowseReleaseGroupsOptions = {}): Promise<ReleaseGroupBrowseResponse> {
    return this.get<ReleaseGroupBrowseResponse>(
      'release-group',
      { artist: artistMbid, type: options.type, inc: joinInc(options.inc), ...pageParams(options) },
      options,
    );
  }

  /** Every release group for an artist, walking pages under the limiter. */
  async *iterateReleaseGroups(artistMbid: string, options: BrowseReleaseGroupsOptions = {}): AsyncGenerator<ReleaseGroup> {
    const limit = options.limit ?? MB_MAX_LIMIT;
    let offset = options.offset ?? 0;
    for (;;) {
      const page = await this.browseReleaseGroups(artistMbid, { ...options, limit, offset });
      for (const group of page['release-groups']) yield group;
      offset += page['release-groups'].length;
      if (page['release-groups'].length === 0 || offset >= page['release-group-count']) return;
    }
  }

  // ------------------------------------------------------------ releases

  lookupRelease(mbid: string, inc: ReleaseInc[] = [], options: CallOptions = {}): Promise<Release | null> {
    return this.lookup<Release>(`release/${mbid}`, inc, options);
  }

  browseReleases(options: BrowseReleasesOptions): Promise<ReleaseBrowseResponse> {
    if (!options.releaseGroup && !options.artist) throw new RangeError('browseReleases needs releaseGroup or artist');
    return this.get<ReleaseBrowseResponse>(
      'release',
      {
        'release-group': options.releaseGroup,
        artist: options.artist,
        status: options.status,
        inc: joinInc(options.inc),
        ...pageParams(options),
      },
      options,
    );
  }

  /**
   * Every release matching the browse, walking pages under the limiter. Release
   * pages are additionally capped at 500 tracks, so the offset advances by the
   * number of releases actually returned, never by the limit.
   */
  async *iterateReleases(options: BrowseReleasesOptions): AsyncGenerator<Release> {
    const limit = options.limit ?? MB_MAX_LIMIT;
    let offset = options.offset ?? 0;
    for (;;) {
      const page = await this.browseReleases({ ...options, limit, offset });
      for (const release of page.releases) yield release;
      offset += page.releases.length;
      if (page.releases.length === 0 || offset >= page['release-count']) return;
    }
  }

  // ---------------------------------------------------------- recordings

  lookupRecording(mbid: string, inc: RecordingInc[] = [], options: CallOptions = {}): Promise<Recording | null> {
    return this.lookup<Recording>(`recording/${mbid}`, inc, options);
  }

  // ----------------------------------------------------------- transport

  private async lookup<T>(path: string, inc: string[], options: CallOptions): Promise<T | null> {
    try {
      return await this.get<T>(path, { inc: joinInc(inc) }, options);
    } catch (error) {
      if (error instanceof MusicBrainzNotFoundError) return null;
      throw error;
    }
  }

  /** Raw GET against WS/2 with `fmt=json`, rate limited and retried. */
  get<T>(path: string, params: Record<string, string | number | undefined>, options: CallOptions = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('fmt', 'json');
    const requestUrl = url.toString();

    return withRetry(
      () =>
        this.limiter.schedule(() => this.send<T>(requestUrl, options.signal), {
          priority: options.priority,
          signal: options.signal,
        }),
      {
        ...this.retry,
        clock: this.clock,
        shouldRetry: (error) => (error instanceof HttpError ? error.isRetryable : error instanceof TypeError),
        onRetry: (error, attempt, delayMs) => {
          // 503 means we (or the whole IP) are over budget: hold every queued request, not just this one.
          if (error instanceof HttpError && (error.status === 503 || error.status === 429)) this.limiter.pause(delayMs);
          this.onRetry?.(error, attempt, delayMs);
        },
      },
    );
  }

  private async send<T>(url: string, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = { method: 'GET', headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } };
    if (signal) init.signal = signal;
    const response = await this.fetchImpl(url, init);
    const text = await response.text();

    if (response.status === 404) throw new MusicBrainzNotFoundError(url);
    if (response.status === 400) throw new MusicBrainzBadRequestError(errorMessage(text) ?? 'Bad request', url);
    if (!response.ok) {
      throw new HttpError(response.status, url, {
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), this.clock.now()),
        body: text.slice(0, 500),
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MusicBrainzError('Non-JSON response from MusicBrainz', response.status, url);
    }
  }
}

function joinInc(inc: readonly string[] | undefined): string | undefined {
  // MusicBrainz accepts space-separated inc values; URLSearchParams encodes the space as '+'.
  return inc && inc.length > 0 ? inc.join(' ') : undefined;
}

function pageParams(options: PageOptions): { limit: number | undefined; offset: number | undefined } {
  return {
    limit: options.limit === undefined ? undefined : Math.min(Math.max(1, options.limit), MB_MAX_LIMIT),
    offset: options.offset,
  };
}

function errorMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; help?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}
