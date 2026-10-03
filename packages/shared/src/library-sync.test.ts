import { describe, expect, it } from 'vitest';

import type { HistoryPage, HistoryPageRequest } from './lastfm-history';
import type { LocalScrobble } from './library';
import { IMPORT_BATCH_MIN_MS, type KeyValueStore, LibraryStore, type LibrarySyncDeps, SNAPSHOT_BUILD, importLibrary, openLibrary, refreshLibrary, replaceLibrary } from './library-sync';

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
  };
}

const T0 = 1_600_000_000;
/** `count` plays, one per minute, artist changing every 60 plays so a few clear the 50-play floor. */
const history = (count: number, from = T0): LocalScrobble[] => Array.from({ length: count }, (_, i) => [from + i * 60, `Artist ${Math.floor(i / 60)}`, `Song ${i % 7}`, 'Album', null]);

/** A Last.fm stand-in: newest first, honours from/to, pages of `perPage`. */
function fakeLastfm(plays: LocalScrobble[], perPage = 50) {
  const state = { plays, calls: [] as HistoryPageRequest[], failOnPage: null as number | null };
  const fetchPage = async (request: HistoryPageRequest): Promise<HistoryPage> => {
    state.calls.push(request);
    if (request.from === undefined && request.page === state.failOnPage) throw new Error('Last.fm answered 500');
    const rows = state.plays.filter((p) => (request.from === undefined || p[0] >= request.from) && (request.to === undefined || p[0] <= request.to)).sort((a, b) => b[0] - a[0]);
    return { scrobbles: rows.slice((request.page - 1) * perPage, request.page * perPage), totalPages: Math.ceil(rows.length / perPage) };
  };
  return { state, fetchPage };
}

function setup(plays: LocalScrobble[], kv = memoryStore()) {
  const lastfm = fakeLastfm(plays);
  const clock = { ms: (T0 + 10_000_000) * 1000 };
  const sleeps: number[] = [];
  const progress: number[] = [];
  const deps: LibrarySyncDeps = {
    store: new LibraryStore(kv, 'Some One'),
    apiKey: 'KEY',
    fetchPage: lastfm.fetchPage,
    now: () => clock.ms,
    sleep: async (ms) => void sleeps.push(ms),
    onProgress: (p) => void progress.push(p.pagesDone),
    snapshotOptions: { yearOf: (uts) => new Date(uts * 1000).getUTCFullYear() },
  };
  return { deps, kv, lastfm: lastfm.state, clock, sleeps, progress };
}

describe('importLibrary', () => {
  it('downloads every page in paced batches against a pinned end time and builds the snapshot', async () => {
    const { deps, lastfm, sleeps, progress, clock } = setup(history(430));
    const { meta, snapshot, added } = await importLibrary(deps);
    expect(snapshot.scrobbleCount).toBe(430);
    expect(added).toBe(430);
    // Seven artists with 60 plays each; the eighth has only 10 and stays out.
    expect(snapshot.artists.map((a) => a.name)).toEqual(['Artist 0', 'Artist 1', 'Artist 2', 'Artist 3', 'Artist 4', 'Artist 5', 'Artist 6']);
    expect(snapshot.artistCount).toBe(8);
    expect(meta).toMatchObject({ complete: true, totalPages: 9, nextPage: 10, storedCount: 430, newestUts: T0 + 429 * 60, syncedAt: clock.ms });

    const importCalls = lastfm.calls.filter((c) => c.from === undefined);
    expect(importCalls.map((c) => c.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(importCalls.map((c) => c.to))).toEqual(new Set([Math.floor(clock.ms / 1000)]));
    expect(progress).toEqual([0, 1, 5, 9]); // one page to learn the total, then four at a time
    expect(sleeps).toEqual([IMPORT_BATCH_MIN_MS, IMPORT_BATCH_MIN_MS]);
    // The top-up after the import asks only for plays newer than the newest stored one.
    expect(lastfm.calls.at(-1)).toMatchObject({ page: 1, from: T0 + 429 * 60 + 1 });
    expect(await deps.store.readSnapshot()).toEqual(snapshot);
  });

  it('resumes from the last stored page after a failure instead of starting over', async () => {
    const { deps, lastfm } = setup(history(430));
    lastfm.failOnPage = 7;
    await expect(importLibrary(deps)).rejects.toThrow('500');
    expect(await deps.store.readMeta()).toMatchObject({ complete: false, nextPage: 6, storedCount: 250 });
    expect(await deps.store.readSnapshot()).toBeNull();

    lastfm.failOnPage = null;
    lastfm.calls.length = 0;
    const { snapshot, meta } = await importLibrary(deps);
    expect(lastfm.calls.filter((c) => c.from === undefined).map((c) => c.page)).toEqual([6, 7, 8, 9]);
    expect(snapshot.scrobbleCount).toBe(430);
    expect(meta.storedCount).toBe(430);
  });

  it('finishes an empty library with an empty snapshot', async () => {
    const { deps } = setup([]);
    const { snapshot, meta } = await importLibrary(deps);
    expect(snapshot).toMatchObject({ scrobbleCount: 0, artists: [] });
    expect(meta).toMatchObject({ complete: true, totalPages: 0, newestUts: null });
  });

  it('stops when aborted and keeps what it had', async () => {
    const { deps, lastfm } = setup(history(430));
    const controller = new AbortController();
    const fetchPage = deps.fetchPage;
    deps.signal = controller.signal;
    deps.fetchPage = async (request) => {
      if (request.page === 5) controller.abort();
      return fetchPage(request);
    };
    await expect(importLibrary(deps)).rejects.toThrow('aborted');
    expect(lastfm.calls.map((c) => c.page)).toEqual([1, 2, 3, 4, 5]);
    expect(await deps.store.readMeta()).toMatchObject({ complete: false, nextPage: 6 });
  });
});

describe('refreshLibrary', () => {
  it('fetches only newer plays and rebuilds the snapshot when there are some', async () => {
    const { deps, lastfm, clock } = setup(history(430));
    await importLibrary(deps);
    lastfm.calls.length = 0;

    const quiet = await refreshLibrary(deps);
    expect(quiet.added).toBe(0);
    expect(lastfm.calls).toHaveLength(1);

    lastfm.plays.push(...history(70, T0 + 5_000_000).map((p): LocalScrobble => [p[0], 'New Favourite', p[2], p[3], p[4]]));
    clock.ms += 60_000;
    lastfm.calls.length = 0;
    const result = await refreshLibrary(deps);
    expect(result.added).toBe(70);
    expect(result.snapshot.scrobbleCount).toBe(500);
    expect(result.snapshot.artists.some((a) => a.name === 'New Favourite')).toBe(true);
    expect(result.meta.syncedAt).toBe(clock.ms);
    expect(lastfm.calls.map((c) => [c.page, c.from])).toEqual([[1, T0 + 429 * 60 + 1], [2, T0 + 429 * 60 + 1]]);
  });

  it('is not thrown off by a play dated in the future', async () => {
    // Last.fm never returns such a play for a request with an end time, but a history file can carry one.
    const future: LocalScrobble = [4_000_000_000, 'Time Traveller', 'Song', null, null];
    const { deps, lastfm } = setup(history(120));
    const { meta, snapshot } = await replaceLibrary(deps, [...history(120), future]);
    expect(snapshot.scrobbleCount).toBe(121);
    expect(snapshot.newestPlayedAt).toBe(T0 + 119 * 60);
    expect(meta.newestUts).toBe(T0 + 119 * 60);
    await refreshLibrary(deps);
    expect(lastfm.calls[0]).toMatchObject({ from: T0 + 119 * 60 + 1 });
  });

  it('runs a full import when no finished library is stored', async () => {
    const { deps } = setup(history(120));
    const result = await refreshLibrary(deps);
    expect(result.snapshot.scrobbleCount).toBe(120);
    expect(result.meta.complete).toBe(true);
  });
});

describe('replaceLibrary and the store', () => {
  it('loads a history file, then tops up from Last.fm', async () => {
    const { deps, lastfm } = setup(history(430));
    const fromFile = history(300); // an older export: the last 130 plays are missing
    const loaded = await replaceLibrary(deps, fromFile);
    expect(loaded.snapshot.scrobbleCount).toBe(300);
    const toppedUp = await refreshLibrary(deps);
    expect(toppedUp.added).toBe(130);
    expect(toppedUp.snapshot.scrobbleCount).toBe(430);
    expect(lastfm.calls.every((c) => c.from === T0 + 299 * 60 + 1)).toBe(true);
  });

  it('keeps libraries apart by user and erases only its own keys', async () => {
    const kv = memoryStore();
    const a = setup(history(60), kv);
    await importLibrary(a.deps);
    const other = new LibraryStore(kv, 'Someone Else');
    await other.writeMeta({ version: 1, username: 'Someone Else', complete: false, pinnedTo: 1, totalPages: null, nextPage: 1, chunkCount: 0, storedCount: 0, newestUts: null, syncedAt: null });
    await a.deps.store.erase();
    expect([...kv.map.keys()]).toEqual(['library:someone else:meta']);
    expect(await new LibraryStore(kv, 'some one').readMeta()).toBeNull();
  });

  it('opens a stored library without touching Last.fm, rebuilding a snapshot made by an older builder', async () => {
    const { deps, lastfm } = setup(history(120));
    expect(await openLibrary(deps)).toBeNull();
    const imported = await importLibrary(deps);
    expect(imported.meta.snapshotBuild).toBe(SNAPSHOT_BUILD);
    lastfm.calls.length = 0;

    // As stored by the first release: no builder revision, and a snapshot the current builder would not produce.
    const { snapshotBuild: _dropped, ...old } = imported.meta;
    await deps.store.writeMeta(old);
    await deps.store.writeSnapshot({ ...imported.snapshot, years: [{ year: 1970, top: [] }] });
    const opened = await openLibrary(deps);
    expect(opened!.snapshot).toEqual(imported.snapshot);
    expect(opened!.meta).toMatchObject({ snapshotBuild: SNAPSHOT_BUILD, syncedAt: imported.meta.syncedAt });
    expect(await deps.store.readSnapshot()).toEqual(imported.snapshot);
    expect(lastfm.calls).toHaveLength(0);
  });

  it('survives a corrupt record instead of throwing', async () => {
    const kv = memoryStore();
    const { deps } = setup(history(60), kv);
    const { meta } = await importLibrary(deps);
    kv.map.set('library:some one:chunk:0', '{not json');
    kv.map.set('library:some one:snapshot', 'null');
    expect(await deps.store.readScrobbles(meta)).toHaveLength(10); // the second chunk is intact
    expect(await deps.store.readSnapshot()).toBeNull();
  });
});
