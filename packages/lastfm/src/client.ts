import {
  type Clock,
  HttpError,
  RateLimiter,
  type RetryOptions,
  parseRetryAfter,
  systemClock,
  withRetry,
} from '@quiztape/ratelimit';

import { LastfmApiError } from './errors';
import { sign } from './signing';
import type {
  LastfmSession,
  RecentTracksParams,
  RecentTracksResponse,
  TopAlbumsResponse,
  TopArtistsResponse,
  TopParams,
  TopTracksResponse,
  UserInfoResponse,
} from './types';

export const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_AUTH_URL = 'https://www.last.fm/api/auth/';
/** Hard cap documented for user.getRecentTracks. */
export const RECENT_TRACKS_MAX_LIMIT = 200;

export interface LastfmClientOptions {
  apiKey: string;
  apiSecret: string;
  fetch?: typeof globalThis.fetch | undefined;
  /** Share one limiter per process so all callers respect the same ~5 req/s. */
  limiter?: RateLimiter | undefined;
  baseUrl?: string | undefined;
  userAgent?: string | undefined;
  retry?: RetryOptions | undefined;
  clock?: Clock | undefined;
  /** Observe retries (logging/metrics). */
  onRetry?: ((error: unknown, attempt: number, delayMs: number) => void) | undefined;
}

export type ParamValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  /** Sign with the API secret (auth methods and anything taking a session key). */
  signed?: boolean | undefined;
  /** The user's session key; implies `signed`. */
  sessionKey?: string | undefined;
  httpMethod?: 'GET' | 'POST' | undefined;
  /** Higher runs first; interactive calls should outrank the backfill job. */
  priority?: number | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Thin, typed Last.fm client. Every call goes through the shared rate limiter
 * and a retry policy that honours Retry-After and pauses siblings on 429 / error 29.
 */
export class LastfmClient {
  readonly limiter: RateLimiter;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly retry: RetryOptions;
  private readonly clock: Clock;
  private readonly onRetry: LastfmClientOptions['onRetry'];

  constructor(options: LastfmClientOptions) {
    if (!options.apiKey) throw new Error('LastfmClient: apiKey is required');
    if (!options.apiSecret) throw new Error('LastfmClient: apiSecret is required');
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? LASTFM_API_URL;
    this.userAgent = options.userAgent ?? 'Quiztape/0.1.0';
    this.clock = options.clock ?? systemClock;
    this.retry = options.retry ?? {};
    this.onRetry = options.onRetry;
    this.limiter =
      options.limiter ??
      new RateLimiter({ name: 'lastfm', requestsPerSecond: 5, burst: 5, concurrency: 2, clock: this.clock });
  }

  /** Where to send the user to authorise the app (web auth flow). Last.fm appends `?token=` on return. */
  authUrl(callbackUrl?: string): string {
    const url = new URL(LASTFM_AUTH_URL);
    url.searchParams.set('api_key', this.apiKey);
    if (callbackUrl) url.searchParams.set('cb', callbackUrl);
    return url.toString();
  }

  /** Exchange the callback token for a long-lived session key (does not expire unless revoked). */
  async getSession(token: string, options: RequestOptions = {}): Promise<LastfmSession> {
    const result = await this.request<{ session: LastfmSession }>('auth.getSession', { token }, { ...options, signed: true });
    return result.session;
  }

  getRecentTracks(params: RecentTracksParams, options: RequestOptions = {}): Promise<RecentTracksResponse> {
    const limit = Math.min(params.limit ?? RECENT_TRACKS_MAX_LIMIT, RECENT_TRACKS_MAX_LIMIT);
    return this.request<RecentTracksResponse>(
      'user.getRecentTracks',
      { user: params.user, page: params.page, limit, from: params.from, to: params.to, extended: params.extended },
      options,
    );
  }

  getTopArtists(params: TopParams, options: RequestOptions = {}): Promise<TopArtistsResponse> {
    return this.request<TopArtistsResponse>('user.getTopArtists', params, options);
  }

  getTopAlbums(params: TopParams, options: RequestOptions = {}): Promise<TopAlbumsResponse> {
    return this.request<TopAlbumsResponse>('user.getTopAlbums', params, options);
  }

  getTopTracks(params: TopParams, options: RequestOptions = {}): Promise<TopTracksResponse> {
    return this.request<TopTracksResponse>('user.getTopTracks', params, options);
  }

  getUserInfo(user: string, options: RequestOptions = {}): Promise<UserInfoResponse> {
    return this.request<UserInfoResponse>('user.getInfo', { user }, options);
  }

  /** Low-level call: builds the query, signs when required, rate limits, retries. */
  async request<T>(method: string, params: Record<string, ParamValue>, options: RequestOptions = {}): Promise<T> {
    const query: Record<string, string> = { method, api_key: this.apiKey };
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      query[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    }
    if (options.sessionKey) query['sk'] = options.sessionKey;
    if (options.signed || options.sessionKey) query['api_sig'] = sign(query, this.apiSecret);
    query['format'] = 'json';

    const httpMethod = options.httpMethod ?? (options.sessionKey ? 'POST' : 'GET');
    const body = new URLSearchParams(query);
    const url = new URL(this.baseUrl);
    if (httpMethod === 'GET') url.search = body.toString();
    const requestUrl = url.toString();

    return withRetry(
      () =>
        this.limiter.schedule(() => this.send<T>(requestUrl, httpMethod, body, options.signal), {
          priority: options.priority,
          signal: options.signal,
        }),
      {
        ...this.retry,
        clock: this.clock,
        shouldRetry: (error) => isRetryable(error),
        retryAfterMs: (error) => {
          if (error instanceof HttpError) return error.retryAfterMs;
          // Error 29 carries no Retry-After; back off a full window and let siblings wait too.
          if (error instanceof LastfmApiError && error.isRateLimit) return 5_000;
          return undefined;
        },
        onRetry: (error, attempt, delayMs) => {
          if ((error instanceof HttpError && error.status === 429) || (error instanceof LastfmApiError && error.isRateLimit)) {
            this.limiter.pause(delayMs);
          }
          this.onRetry?.(error, attempt, delayMs);
        },
      },
    );
  }

  private async send<T>(url: string, httpMethod: 'GET' | 'POST', body: URLSearchParams, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = {
      method: httpMethod,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
        ...(httpMethod === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    };
    if (httpMethod === 'POST') init.body = body.toString();
    if (signal) init.signal = signal;

    const response = await this.fetchImpl(httpMethod === 'GET' ? url : this.baseUrl, init);
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      json = undefined;
    }

    // Last.fm reports API errors in the body, with either a 200 or a 4xx/5xx status.
    if (json && typeof json === 'object' && 'error' in json) {
      const payload = json as { error: number | string; message?: string };
      throw new LastfmApiError(Number(payload.error), payload.message ?? 'Unknown error', response.status);
    }
    if (!response.ok) {
      throw new HttpError(response.status, url, {
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), this.clock.now()),
        body: text.slice(0, 500),
      });
    }
    if (json === undefined) {
      throw new HttpError(response.status, url, { body: 'Empty or non-JSON response body' });
    }
    return json as T;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LastfmApiError) return error.isRetryable;
  if (error instanceof HttpError) return error.isRetryable;
  if (error instanceof TypeError) return true; // fetch network failure
  return false;
}
