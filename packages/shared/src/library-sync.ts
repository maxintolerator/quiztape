import type { HistoryPage, HistoryPageRequest } from './lastfm-history';
import { type LocalScrobble, type SnapshotOptions, type StatsSnapshot, buildStatsSnapshot, nameKey } from './library';

/**
 * Keeping a library on the device: a resumable first import, cheap top-ups
 * afterwards, and a snapshot rebuilt whenever plays were added. Storage and
 * network are injected, so the same code runs on web (IndexedDB), on iOS and
 * Android (SQLite) and in tests (a Map).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export interface LibraryMeta {
  version: 1;
  username: string;
  /** A full import has finished and a snapshot is stored. */
  complete: boolean;
  /** Upper bound of the import (unix seconds), pinned so page numbers stay put while new plays arrive. */
  pinnedTo: number;
  totalPages: number | null;
  /** Next page of the import to fetch; everything before it is stored. */
  nextPage: number;
  chunkCount: number;
  /** Rows stored, before duplicates are dropped. */
  storedCount: number;
  newestUts: number | null;
  /** When the library last caught up with Last.fm, in milliseconds. */
  syncedAt: number | null;
}

export const IMPORT_PAGES_PER_BATCH = 4;
/** Four pages every 0.9 s is about 4.4 requests a second, under Last.fm's five per second per IP. */
export const IMPORT_BATCH_MIN_MS = 900;
const TOP_UP_PAGE_GAP_MS = 250;
const FILE_CHUNK_ROWS = 2_000;

/** One player's library in a key-value store: a meta record, the plays in chunks, and the snapshot built from them. */
export class LibraryStore {
  private readonly prefix: string;

  constructor(
    private readonly kv: KeyValueStore,
    readonly username: string,
  ) {
    this.prefix = `library:${nameKey(username)}:`;
  }

  async readMeta(): Promise<LibraryMeta | null> {
    const meta = parse<LibraryMeta>(await this.kv.get(`${this.prefix}meta`));
    return meta?.version === 1 ? meta : null;
  }

  async writeMeta(meta: LibraryMeta): Promise<void> {
    await this.kv.set(`${this.prefix}meta`, JSON.stringify(meta));
  }

  /** Store plays as the next chunk, then advance the meta. A crash in between leaves an orphan chunk the next write replaces. */
  async append(meta: LibraryMeta, scrobbles: LocalScrobble[], patch: Partial<LibraryMeta> = {}): Promise<LibraryMeta> {
    let next: LibraryMeta = { ...meta, ...patch };
    if (scrobbles.length > 0) {
      await this.kv.set(`${this.prefix}chunk:${meta.chunkCount}`, JSON.stringify(scrobbles));
      const newest = scrobbles.reduce((max, row) => Math.max(max, row[0]), meta.newestUts ?? 0);
      next = { ...next, chunkCount: meta.chunkCount + 1, storedCount: meta.storedCount + scrobbles.length, newestUts: newest };
    }
    await this.writeMeta(next);
    return next;
  }

  async readScrobbles(meta: LibraryMeta): Promise<LocalScrobble[]> {
    const all: LocalScrobble[] = [];
    for (let index = 0; index < meta.chunkCount; index++) {
      const chunk = parse<LocalScrobble[]>(await this.kv.get(`${this.prefix}chunk:${index}`));
      if (Array.isArray(chunk)) for (const row of chunk) all.push(row);
    }
    return all;
  }

  async readSnapshot(): Promise<StatsSnapshot | null> {
    const snapshot = parse<StatsSnapshot>(await this.kv.get(`${this.prefix}snapshot`));
    return snapshot?.version === 1 ? snapshot : null;
  }

  async writeSnapshot(snapshot: StatsSnapshot): Promise<void> {
    await this.kv.set(`${this.prefix}snapshot`, JSON.stringify(snapshot));
  }

  async erase(): Promise<void> {
    for (const key of await this.kv.keys(this.prefix)) await this.kv.delete(key);
  }
}

function parse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface ImportProgress {
  pagesDone: number;
  pagesTotal: number | null;
  scrobbles: number;
}

export interface LibrarySyncDeps {
  store: LibraryStore;
  apiKey: string;
  fetchPage: (request: HistoryPageRequest) => Promise<HistoryPage>;
  /** Milliseconds since the epoch. */
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: ImportProgress) => void) | undefined;
  snapshotOptions?: SnapshotOptions | undefined;
}

export interface LibraryResult {
  meta: LibraryMeta;
  snapshot: StatsSnapshot;
  /** Plays added by this run. */
  added: number;
}

const seconds = (ms: number) => Math.floor(ms / 1000);

function freshMeta(username: string, pinnedTo: number): LibraryMeta {
  return { version: 1, username, complete: false, pinnedTo, totalPages: null, nextPage: 1, chunkCount: 0, storedCount: 0, newestUts: null, syncedAt: null };
}

/**
 * Download the whole history, newest page first, a few pages at a time.
 * Progress is checkpointed after every batch: calling this again after a
 * closed tab or a failed request carries on from the last stored page.
 */
export async function importLibrary(deps: LibrarySyncDeps): Promise<LibraryResult> {
  const { store, apiKey, fetchPage, now, sleep, signal, onProgress } = deps;
  let meta = await store.readMeta();
  if (!meta || meta.complete) {
    await store.erase();
    meta = freshMeta(store.username, seconds(now()));
    await store.writeMeta(meta);
  }
  const { pinnedTo } = meta;
  onProgress?.({ pagesDone: meta.nextPage - 1, pagesTotal: meta.totalPages, scrobbles: meta.storedCount });

  while (meta.totalPages === null || meta.nextPage <= meta.totalPages) {
    if (signal?.aborted) throw new Error('aborted');
    const started = now();
    const first = meta.nextPage;
    // The first request alone says how many pages there are.
    const count = meta.totalPages === null ? 1 : Math.min(IMPORT_PAGES_PER_BATCH, meta.totalPages - first + 1);
    const pages = await Promise.all(Array.from({ length: count }, (_, i) => fetchPage({ apiKey, username: store.username, page: first + i, to: pinnedTo, signal })));
    meta = await store.append(meta, pages.flatMap((page) => page.scrobbles), { totalPages: meta.totalPages ?? pages[0]!.totalPages, nextPage: first + count });
    onProgress?.({ pagesDone: meta.nextPage - 1, pagesTotal: meta.totalPages, scrobbles: meta.storedCount });
    if (meta.totalPages !== null && meta.nextPage <= meta.totalPages) await sleep(Math.max(0, IMPORT_BATCH_MIN_MS - (now() - started)), signal);
  }

  meta = await fetchNewer(deps, meta);
  const result = await finish(deps, meta);
  return { ...result, added: result.meta.storedCount };
}

/** Fetch what was played since the last sync. Falls back to a full import when there is no finished library. */
export async function refreshLibrary(deps: LibrarySyncDeps): Promise<LibraryResult> {
  const { store, now } = deps;
  const meta = await store.readMeta();
  if (!meta?.complete) return importLibrary(deps);
  const before = meta.storedCount;
  const next = await fetchNewer(deps, meta);
  const snapshot = next.storedCount === before ? await store.readSnapshot() : null;
  if (snapshot) {
    const caughtUp = { ...next, syncedAt: now() };
    await store.writeMeta(caughtUp);
    return { meta: caughtUp, snapshot, added: 0 };
  }
  const result = await finish(deps, next);
  return { ...result, added: next.storedCount - before };
}

/** Replace the library with plays loaded from a history file. Run `refreshLibrary` afterwards to top it up. */
export async function replaceLibrary(deps: Pick<LibrarySyncDeps, 'store' | 'now' | 'snapshotOptions'>, scrobbles: LocalScrobble[]): Promise<LibraryResult> {
  const { store, now } = deps;
  await store.erase();
  let meta: LibraryMeta = { ...freshMeta(store.username, seconds(now())), totalPages: 0 };
  for (let offset = 0; offset < scrobbles.length; offset += FILE_CHUNK_ROWS) {
    meta = await store.append(meta, scrobbles.slice(offset, offset + FILE_CHUNK_ROWS));
  }
  const result = await finish(deps, meta);
  return { ...result, added: scrobbles.length };
}

/** Everything strictly newer than the newest stored play (or than the import's pin, for an empty library). */
async function fetchNewer(deps: LibrarySyncDeps, meta: LibraryMeta): Promise<LibraryMeta> {
  const { store, apiKey, fetchPage, now, sleep, signal } = deps;
  const from = (meta.newestUts ?? meta.pinnedTo) + 1;
  const to = seconds(now());
  if (to < from) return meta;
  const added: LocalScrobble[] = [];
  for (let page = 1; ; page++) {
    if (signal?.aborted) throw new Error('aborted');
    const result = await fetchPage({ apiKey, username: store.username, page, from, to, signal });
    for (const row of result.scrobbles) added.push(row);
    if (page >= result.totalPages || result.scrobbles.length === 0) break;
    await sleep(TOP_UP_PAGE_GAP_MS, signal);
  }
  return added.length > 0 ? store.append(meta, added) : meta;
}

async function finish(deps: Pick<LibrarySyncDeps, 'store' | 'now' | 'snapshotOptions'>, meta: LibraryMeta): Promise<LibraryResult> {
  const { store, now, snapshotOptions } = deps;
  const snapshot = buildStatsSnapshot(await store.readScrobbles(meta), snapshotOptions);
  await store.writeSnapshot(snapshot);
  const done: LibraryMeta = { ...meta, complete: true, syncedAt: now() };
  await store.writeMeta(done);
  return { meta: done, snapshot, added: 0 };
}
