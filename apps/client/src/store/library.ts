import {
  type ImportProgress,
  LastfmHistoryError,
  type LibraryResult,
  LibraryStore,
  type LibrarySyncDeps,
  type StatsSnapshot,
  fetchHistoryPage,
  importLibrary,
  nameKey,
  openLibrary,
  parseHistoryFile,
  refreshLibrary,
  replaceLibrary,
  sleep,
  toHistoryFile,
} from '@quiztape/shared';
import { create } from 'zustand';

import { historyFileSupported, pickHistoryFile, saveHistoryFile } from '@/lib/history-file';
import { kvDelete, kvGet, kvIsPersistent, kvKeys, kvSet } from '@/lib/kv';

/**
 * idle: nobody signed in. loading: reading what is stored on this device.
 * syncing: the first import is running. ready: a snapshot exists and rounds
 * can be cut from it. The last two are the import's dead ends.
 */
export type LibraryPhase = 'idle' | 'loading' | 'syncing' | 'ready' | 'privacy_blocked' | 'error';

const REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const kv = { get: kvGet, set: kvSet, delete: kvDelete, keys: kvKeys };

interface LibraryState {
  phase: LibraryPhase;
  username: string | null;
  /** The library boiled down for the question engine; sent with every round request. */
  snapshot: StatsSnapshot | null;
  progress: ImportProgress | null;
  /** Topping up or loading a file while the library stays playable. */
  refreshing: boolean;
  syncedAt: number | null;
  /** False when the browser would not store the library: it lives in memory for this tab only. */
  persistent: boolean;
  lastError: string | null;
  /** Load this player's library from the device, or start importing it. Safe to call again. */
  open: (username: string, apiKey: string) => Promise<void>;
  /** Start or resume the first import. */
  retry: () => Promise<void>;
  /** Fetch plays newer than the last sync. Skipped when one ran in the last ten minutes, unless forced. */
  refresh: (force?: boolean) => Promise<void>;
  /** Save the stored history as a file. */
  download: () => Promise<void>;
  /** Replace the stored history with a file saved earlier. Resolves false when nothing was loaded. */
  loadFile: () => Promise<boolean>;
  /** Signed out: stop any download and forget the in-memory state. The stored library stays for next time. */
  close: () => void;
  /** Delete this player's library from the device. */
  erase: () => Promise<void>;
}

const INITIAL = { phase: 'idle' as LibraryPhase, username: null, snapshot: null, progress: null, refreshing: false, syncedAt: null, persistent: true, lastError: null };

let apiKey: string | null = null;
let controller: AbortController | null = null;
let running: Promise<void> | null = null;

export const fileTransferSupported = historyFileSupported;

export const useLibrary = create<LibraryState>((set, get) => {
  const depsFor = (username: string, key: string, signal: AbortSignal): LibrarySyncDeps => ({
    store: new LibraryStore(kv, username),
    apiKey: key,
    fetchPage: (request) => fetchHistoryPage(request),
    now: () => Date.now(),
    sleep,
    signal,
    onProgress: (progress) => {
      if (!signal.aborted) set({ progress });
    },
  });

  /** One download at a time; a second caller waits for the first instead of racing it. */
  const exclusive = (task: (username: string, signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (running) return running;
    const { username } = get();
    if (!username) return Promise.resolve();
    controller = new AbortController();
    const { signal } = controller;
    running = task(username, signal)
      .catch((error: unknown) => {
        if (signal.aborted || get().username !== username) return;
        // With a library already on the device a failed top-up is only a note; without one it is a dead end.
        const fallback = error instanceof LastfmHistoryError && error.privacyBlocked ? 'privacy_blocked' : 'error';
        set({ phase: get().snapshot !== null ? 'ready' : fallback, lastError: describe(error) });
      })
      .finally(() => {
        running = null;
        if (get().username === username) set({ refreshing: false });
      });
    return running;
  };

  const accept = (result: LibraryResult) => set({ phase: 'ready', snapshot: result.snapshot, syncedAt: result.meta.syncedAt, progress: null, lastError: null, persistent: kvIsPersistent() });

  return {
    ...INITIAL,

    open: async (username, key) => {
      apiKey = key;
      if (get().username === username && get().phase !== 'idle') return;
      controller?.abort();
      await running; // a previous player's download has to wind down first
      set({ ...INITIAL, username, phase: 'loading' });
      const stored = await openLibrary({ store: new LibraryStore(kv, username), now: () => Date.now() }).catch(() => null);
      if (get().username !== username) return;
      if (stored) {
        accept(stored);
        void get().refresh();
        return;
      }
      await get().retry();
    },

    retry: () =>
      exclusive(async (username, signal) => {
        if (!apiKey) return;
        set({ phase: 'syncing', lastError: null });
        accept(await importLibrary(depsFor(username, apiKey, signal)));
      }),

    refresh: (force = false) => {
      const { phase, syncedAt } = get();
      if (phase !== 'ready') return Promise.resolve();
      if (!force && syncedAt !== null && Date.now() - syncedAt < REFRESH_MIN_INTERVAL_MS) return Promise.resolve();
      return exclusive(async (username, signal) => {
        if (!apiKey) return;
        set({ refreshing: true, lastError: null });
        accept(await refreshLibrary(depsFor(username, apiKey, signal)));
      });
    },

    download: async () => {
      const { username } = get();
      if (!username) return;
      const store = new LibraryStore(kv, username);
      const meta = await store.readMeta();
      if (!meta) return;
      const file = toHistoryFile(username, await store.readScrobbles(meta));
      await saveHistoryFile(`quiztape-${nameKey(username).replace(/[^a-z0-9_-]+/g, '-')}.json`, JSON.stringify(file));
    },

    loadFile: async () => {
      const text = await pickHistoryFile();
      if (text === null) return false;
      const file = parseHistoryFile(text);
      const { username } = get();
      if (!file || !username) {
        set({ lastError: 'That is not a Quiztape history file.' });
        return false;
      }
      if (nameKey(file.username) !== nameKey(username)) {
        set({ lastError: `That file belongs to ${file.username}, not ${username}.` });
        return false;
      }
      controller?.abort();
      await running;
      let loaded = false;
      await exclusive(async (name, signal) => {
        set({ refreshing: true, lastError: null });
        const deps = depsFor(name, apiKey ?? '', signal);
        accept(await replaceLibrary(deps, file.scrobbles));
        loaded = true;
        // The file may be old: catch up with Last.fm straight away.
        if (apiKey) accept(await refreshLibrary(deps));
      });
      return loaded;
    },

    close: () => {
      controller?.abort();
      apiKey = null;
      set({ ...INITIAL });
    },

    erase: async () => {
      const { username } = get();
      controller?.abort();
      await running;
      if (username) await new LibraryStore(kv, username).erase();
      apiKey = null;
      set({ ...INITIAL });
    },
  };
});

function describe(error: unknown): string {
  if (error instanceof LastfmHistoryError) {
    if (error.code === 6) return 'Last.fm does not know this user.';
    if (error.privacyBlocked) return 'Last.fm is hiding your recent listening (a privacy setting on your account), so plays cannot be read.';
    if (error.code === 29) return 'Last.fm is rate limiting this connection. Wait a minute, then try again.';
    return error.code === null ? `Could not reach Last.fm (${error.message}). Check your connection, then try again.` : `Last.fm returned an error: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
