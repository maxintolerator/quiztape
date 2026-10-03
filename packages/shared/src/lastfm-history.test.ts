import { describe, expect, it } from 'vitest';

import { LastfmHistoryError, fetchHistoryPage } from './lastfm-history';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = (uts: number, artist: string, name: string) => ({ artist: { '#text': artist, mbid: '' }, name, album: { '#text': 'Album' }, date: { uts: String(uts) } });
const page = (track: unknown, totalPages = 3) => json({ recenttracks: { track, '@attr': { totalPages: String(totalPages) } } });

function scripted(responses: (() => Response | Promise<Response>)[]) {
  const urls: URL[] = [];
  const waits: number[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(new URL(url));
    return responses[Math.min(urls.length, responses.length) - 1]!();
  }) as unknown as typeof fetch;
  return { urls, waits, deps: { fetch: fetchImpl, sleep: async (ms: number) => void waits.push(ms) } };
}

const request = { apiKey: 'KEY', username: 'some one', page: 2, to: 1_700_000_000 };

describe('fetchHistoryPage', () => {
  it('asks Last.fm for one page of 200 with the app key and nothing secret', async () => {
    const fake = scripted([() => page([row(1_600_000_300, 'Radiohead', 'Airbag'), row(1_600_000_000, 'Burial', 'Archangel')])]);
    const result = await fetchHistoryPage(request, fake.deps);
    expect(result.totalPages).toBe(3);
    expect(result.scrobbles).toEqual([
      [1_600_000_300, 'Radiohead', 'Airbag', 'Album', null],
      [1_600_000_000, 'Burial', 'Archangel', 'Album', null],
    ]);
    const [url] = fake.urls;
    expect(url!.origin + url!.pathname).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(Object.fromEntries(url!.searchParams)).toEqual({ method: 'user.getrecenttracks', user: 'some one', api_key: 'KEY', format: 'json', limit: '200', page: '2', to: '1700000000' });
  });

  it('handles a one-row page (a bare object) and drops the now-playing row', async () => {
    const one = scripted([() => page(row(1_600_000_000, 'Burial', 'Archangel'), 1)]);
    expect((await fetchHistoryPage(request, one.deps)).scrobbles).toHaveLength(1);
    const live = scripted([() => page([{ artist: { '#text': 'Burial' }, name: 'Live', '@attr': { nowplaying: 'true' } }, row(1_600_000_000, 'Burial', 'Archangel')], 1)]);
    expect((await fetchHistoryPage(request, live.deps)).scrobbles).toHaveLength(1);
    const empty = scripted([() => json({ recenttracks: { track: [], '@attr': { totalPages: '0' } } })]);
    await expect(fetchHistoryPage(request, empty.deps)).resolves.toEqual({ scrobbles: [], totalPages: 0 });
  });

  it('reports a privacy-blocked account at once, without retrying', async () => {
    const fake = scripted([() => json({ error: 17, message: 'Login: User required to be logged in' }, 403)]);
    const error = await fetchHistoryPage(request, fake.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LastfmHistoryError);
    expect((error as LastfmHistoryError).privacyBlocked).toBe(true);
    expect(fake.urls).toHaveLength(1);
  });

  it('retries backend hiccups and rate limits with back-off, then succeeds', async () => {
    const fake = scripted([() => json({ error: 8, message: 'Operation failed' }, 500), () => new Response('<html>bad gateway</html>', { status: 502 }), () => json({ error: 29, message: 'Rate limit exceeded' }, 429), () => page([row(1_600_000_000, 'Burial', 'Archangel')])]);
    const result = await fetchHistoryPage(request, fake.deps);
    expect(result.scrobbles).toHaveLength(1);
    expect(fake.waits).toEqual([1_000, 2_000, 20_000]);
  });

  it('gives up after the allowed attempts and says why', async () => {
    const fake = scripted([() => Promise.reject(new TypeError('Failed to fetch'))]);
    await expect(fetchHistoryPage(request, { ...fake.deps, attempts: 3 })).rejects.toMatchObject({ name: 'LastfmHistoryError', code: null, message: 'Failed to fetch' });
    expect(fake.urls).toHaveLength(3);
  });

  it('stops immediately when aborted', async () => {
    const controller = new AbortController();
    const fake = scripted([() => { controller.abort(); return Promise.reject(new Error('The operation was aborted')); }]);
    await expect(fetchHistoryPage({ ...request, signal: controller.signal }, fake.deps)).rejects.toThrow('aborted');
    expect(fake.urls).toHaveLength(1);
  });
});
