import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LastfmClient } from './client';
import { LastfmApiError } from './errors';
import { asArray, normalizeRecentTrack } from './normalize';
import type { RecentTrack, RecentTracksResponse } from './types';

type FetchCall = { url: string; init: RequestInit | undefined };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function makeClient(responses: Array<() => Response>, calls: FetchCall[] = []) {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return next();
  });
  const client = new LastfmClient({
    apiKey: 'KEY',
    apiSecret: 'SECRET',
    fetch: fetchImpl as unknown as typeof fetch,
    retry: { baseDelayMs: 10, random: () => 0 },
  });
  return { client, calls, fetchImpl };
}

describe('LastfmClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the auth URL with api_key and callback', () => {
    const { client } = makeClient([]);
    expect(client.authUrl('https://quiztape.example/auth/lastfm/callback')).toBe(
      'https://www.last.fm/api/auth/?api_key=KEY&cb=https%3A%2F%2Fquiztape.example%2Fauth%2Flastfm%2Fcallback',
    );
  });

  it('sends unsigned GET requests with method, api_key and format=json, capping limit at 200', async () => {
    const page: RecentTracksResponse = {
      recenttracks: { track: [], '@attr': { user: 'u', totalPages: '0', page: '1', perPage: '200', total: '0' } },
    };
    const { client, calls } = makeClient([() => jsonResponse(page)]);
    const promise = client.getRecentTracks({ user: 'someone', limit: 999, page: 3, extended: true });
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toEqual(page);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      method: 'user.getRecentTracks',
      api_key: 'KEY',
      user: 'someone',
      page: '3',
      limit: '200',
      extended: '1',
      format: 'json',
    });
    expect(calls[0]!.init?.method).toBe('GET');
    expect((calls[0]!.init?.headers as Record<string, string>)['User-Agent']).toContain('Quiztape');
  });

  it('signs auth.getSession and returns the session', async () => {
    const { client, calls } = makeClient([() => jsonResponse({ session: { name: 'someone', key: 'sk123', subscriber: 0 } })]);
    const promise = client.getSession('TOKEN');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toEqual({ name: 'someone', key: 'sk123', subscriber: 0 });
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.get('api_sig')).toMatch(/^[0-9a-f]{32}$/);
    expect(params.get('token')).toBe('TOKEN');
    expect(params.get('format')).toBe('json');
  });

  it('turns body-level API errors into LastfmApiError even on HTTP 200', async () => {
    const { client } = makeClient([() => jsonResponse({ error: 6, message: 'User not found' })]);
    const promise = client.getUserInfo('ghost').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    const error = await promise;
    expect(error).toBeInstanceOf(LastfmApiError);
    expect((error as LastfmApiError).code).toBe(6);
    expect((error as LastfmApiError).isRetryable).toBe(false);
  });

  it('retries error 29 (rate limit) and pauses the limiter meanwhile', async () => {
    const { client, calls } = makeClient([
      () => jsonResponse({ error: 29, message: 'Rate limit exceeded' }, 429),
      () => jsonResponse({ user: { name: 'someone', playcount: '1' } }),
    ]);
    const promise = client.getUserInfo('someone');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(client.limiter.stats().pausedForMs).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await expect(promise).resolves.toMatchObject({ user: { name: 'someone' } });
  });

  it('honours Retry-After on HTTP 503 without a JSON body', async () => {
    const { client, calls } = makeClient([
      () => new Response('<html>busy</html>', { status: 503, headers: { 'retry-after': '2' } }),
      () => jsonResponse({ user: { name: 'someone' } }),
    ]);
    const promise = client.getUserInfo('someone');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await expect(promise).resolves.toBeTruthy();
  });

  it('never exceeds 5 requests per second across concurrent callers', async () => {
    const responses = Array.from({ length: 12 }, () => () => jsonResponse({ user: { name: 'x' } }));
    const { client, calls } = makeClient(responses);
    const all = Promise.all(Array.from({ length: 12 }, (_, i) => client.getUserInfo(`u${i}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBeLessThanOrEqual(5);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.length).toBeLessThanOrEqual(10);
    await vi.advanceTimersByTimeAsync(1_000);
    await all;
    expect(calls).toHaveLength(12);
  });
});

describe('normalizeRecentTrack', () => {
  const base: RecentTrack = {
    artist: { '#text': 'Boards of Canada', mbid: '69158f97-4c07-4c4e-baf8-4e4ab1ed666e' },
    name: 'Roygbiv',
    mbid: '',
    url: 'https://www.last.fm/music/Boards+of+Canada/_/Roygbiv',
    streamable: '0',
    album: { '#text': 'Music Has the Right to Children', mbid: '' },
    image: [],
    date: { uts: '1700000000', '#text': '14 Nov 2023, 22:13' },
  };

  it('maps a scrobble row, nulling empty MBIDs', () => {
    expect(normalizeRecentTrack(base)).toEqual({
      playedAtUts: 1_700_000_000,
      artistName: 'Boards of Canada',
      artistMbid: '69158f97-4c07-4c4e-baf8-4e4ab1ed666e',
      trackName: 'Roygbiv',
      trackMbid: null,
      albumName: 'Music Has the Right to Children',
      albumMbid: null,
      loved: null,
    });
  });

  it('drops the now-playing pseudo row', () => {
    const { date: _date, ...withoutDate } = base;
    expect(normalizeRecentTrack({ ...withoutDate, '@attr': { nowplaying: 'true' } })).toBeNull();
  });

  it('reads the extended artist shape and loved flag', () => {
    const extended: RecentTrack = { ...base, artist: { name: 'BoC', mbid: '', url: '', image: [] }, loved: '1' };
    expect(normalizeRecentTrack(extended)).toMatchObject({ artistName: 'BoC', artistMbid: null, loved: true });
  });

  it('asArray handles the single-object page shape', () => {
    expect(asArray(base)).toEqual([base]);
    expect(asArray([base])).toEqual([base]);
    expect(asArray(undefined)).toEqual([]);
  });
});
