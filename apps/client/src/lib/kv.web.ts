/**
 * Web implementation of the library key-value contract: IndexedDB, which
 * holds far more than localStorage's ~5 MB. It can be unavailable (private
 * mode, blocked site data) or full, so every access is guarded: what cannot
 * be stored is kept in memory for this tab and `kvIsPersistent` turns false.
 */
const DB_NAME = 'quiztape';
const STORE = 'library';

const memory = new Map<string, string>();
let persistent = true;
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    const unavailable = () => {
      persistent = false;
      resolve(null);
    };
    try {
      const factory = globalThis.indexedDB;
      if (!factory) return unavailable();
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = unavailable;
      request.onblocked = unavailable;
    } catch {
      unavailable();
    }
  });
  return opening;
}

/** Run one request in its own transaction. Resolves undefined when IndexedDB is unavailable; rejects when the write fails. */
async function run<T>(mode: IDBTransactionMode, start: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = start(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function kvGet(key: string): Promise<string | null> {
  const held = memory.get(key);
  if (held !== undefined) return held;
  try {
    const value = await run<unknown>('readonly', (store) => store.get(key));
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    if ((await open()) !== null) {
      await run('readwrite', (store) => store.put(value, key));
      memory.delete(key);
      return;
    }
  } catch {
    // quota exceeded or the write was refused: keep it for this tab
  }
  persistent = false;
  memory.set(key, value);
}

export async function kvDelete(key: string): Promise<void> {
  memory.delete(key);
  try {
    await run('readwrite', (store) => store.delete(key));
  } catch {
    // ignore
  }
}

export async function kvKeys(prefix: string): Promise<string[]> {
  const keys = new Set([...memory.keys()].filter((key) => key.startsWith(prefix)));
  try {
    const stored = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    for (const key of stored ?? []) if (typeof key === 'string') keys.add(key);
  } catch {
    // ignore
  }
  return [...keys];
}

/** False once anything had to be kept in memory: the library will need downloading again next visit. */
export function kvIsPersistent(): boolean {
  return persistent;
}
