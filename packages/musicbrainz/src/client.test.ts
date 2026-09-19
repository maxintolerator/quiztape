import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MusicBrainzClient } from './client';
import { MusicBrainzBadRequestError } from './errors';
import { fieldQuery, luceneEscape } from './lucene';

type FetchCall = { url: string; init: RequestInit | undefined };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function makeClient(responses: Array<() => Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return next();
  });
  const client = new MusicBrainzClient({
    appName: 'Quiztape',
    appVersion: '0.1.0',
    contact: 'dev@quiztape.example',
    fetch: fetchImpl as unknown as typeof fetch,
    retry: { baseDelayMs: 10, random: () => 0 },
  });
  return { client, calls };
}

describe('MusicBrainzClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to start without a contact for the User-Agent', () => {
    expect(() => new MusicBrainzClient({ appName: 'Q', appVersion: '1', contact: '' })).toThrow(/User-Agent/);
  });

  it('sends the mandatory User-Agent, fmt=json and space-joined inc', async () => {
    const { client, calls } = makeClient([() => json({ id: 'abc', name: 'Radiohead' })]);
    const promise = client.lookupArtist('abc', ['artist-rels', 'url-rels']);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toMatchObject({ name: 'Radiohead' });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://musicbrainz.org/ws/2/artist/abc');
    expect(url.searchParams.get('inc')).toBe('artist-rels url-rels');
    expect(url.search).toContain('inc=artist-rels+url-rels');
    expect(url.searchParams.get('fmt')).toBe('json');
    expect((calls[0]!.init?.headers as Record<string, string>)['User-Agent']).toBe('Quiztape/0.1.0 ( dev@quiztape.example )');
  });

  it('returns null on 404 so callers can negative-cache', async () => {
    const { client } = makeClient([() => new Response('{"error":"Not Found"}', { status: 404 })]);
    const promise = client.lookupArtist('missing');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeNull();
  });

  it('throws a non-retryable error on 400', async () => {
    const { client, calls } = makeClient([() => json({ error: 'Invalid inc', help: '...' }, 400)]);
    const promise = client.searchArtists('artist:x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBeInstanceOf(MusicBrainzBadRequestError);
    expect(calls).toHaveLength(1);
  });

  it('retries 503 and pauses the shared queue for Retry-After', async () => {
    const { client, calls } = makeClient([
      () => new Response('busy', { status: 503, headers: { 'retry-after': '3' } }),
      () => json({ id: 'abc', name: 'Radiohead' }),
    ]);
    const promise = client.lookupArtist('abc');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(client.limiter.stats().pausedForMs).toBeGreaterThanOrEqual(2_999);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await expect(promise).resolves.toMatchObject({ name: 'Radiohead' });
  });

  it('spaces concurrent requests at one per second', async () => {
    const responses = Array.from({ length: 4 }, (_, i) => () => json({ id: `a${i}`, name: `A${i}` }));
    const { client, calls } = makeClient(responses);
    const all = Promise.all([0, 1, 2, 3].map((i) => client.lookupArtist(`a${i}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(4);
    await all;
  });

  it('walks release-group pages until the count is exhausted', async () => {
    const { client, calls } = makeClient([
      () => json({ 'release-group-count': 3, 'release-group-offset': 0, 'release-groups': [{ id: 'r1' }, { id: 'r2' }] }),
      () => json({ 'release-group-count': 3, 'release-group-offset': 2, 'release-groups': [{ id: 'r3' }] }),
    ]);
    const seen: string[] = [];
    const run = (async () => {
      for await (const group of client.iterateReleaseGroups('artist-1', { type: 'album', limit: 2 })) seen.push(group.id);
    })();
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(seen).toEqual(['r1', 'r2', 'r3']);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe('/ws/2/release-group');
    expect(first.searchParams.get('artist')).toBe('artist-1');
    expect(first.searchParams.get('type')).toBe('album');
    expect(first.searchParams.get('limit')).toBe('2');
    expect(new URL(calls[1]!.url).searchParams.get('offset')).toBe('2');
  });

  it('clamps page size to 100', async () => {
    const { client, calls } = makeClient([() => json({ created: '', count: 0, offset: 0, artists: [] })]);
    const promise = client.searchArtistsByName('Boards of Canada', { limit: 500 });
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.get('limit')).toBe('100');
    expect(params.get('query')).toBe('artist:"Boards of Canada"');
  });
});

describe('lucene helpers', () => {
  it('escapes special characters', () => {
    expect(luceneEscape('AC/DC (live) + more?')).toBe('AC\\/DC \\(live\\) \\+ more\\?');
  });
  it('quotes field values and escapes embedded quotes', () => {
    expect(fieldQuery('artist', 'The "Band"')).toBe('artist:"The \\"Band\\""');
  });
});

describe('MusicBrainzClient (merges, search modes, release paging)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('surfaces the canonical id when a merged MBID was redirected', async () => {
    const { client } = makeClient([() => json({ id: 'canonical-id', name: 'Jónsi' })]);
    const promise = client.lookupArtist('old-merged-id');
    await vi.advanceTimersByTimeAsync(0);
    const artist = await promise;
    expect(artist?.id).toBe('canonical-id');
    expect(artist?.id).not.toBe('old-merged-id');
  });

  it('passes dismax=true for plain-text searches', async () => {
    const { client, calls } = makeClient([() => json({ created: '', count: 0, offset: 0, artists: [] })]);
    const promise = client.searchArtists('ac/dc', { dismax: true });
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(new URL(calls[0]!.url).searchParams.get('dismax')).toBe('true');
  });

  it('advances release paging by rows returned, not by limit', async () => {
    const { client, calls } = makeClient([
      () => json({ 'release-count': 5, 'release-offset': 0, releases: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] }),
      () => json({ 'release-count': 5, 'release-offset': 3, releases: [{ id: 'r4' }, { id: 'r5' }] }),
    ]);
    const seen: string[] = [];
    const run = (async () => {
      for await (const release of client.iterateReleases({ releaseGroup: 'rg', status: 'official', inc: ['media'], limit: 100 })) {
        seen.push(release.id);
      }
    })();
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(seen).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(new URL(calls[1]!.url).searchParams.get('offset')).toBe('3');
    expect(new URL(calls[0]!.url).searchParams.get('status')).toBe('official');
  });
});
