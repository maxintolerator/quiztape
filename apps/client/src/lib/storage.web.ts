/**
 * Web implementation of the storage contract. localStorage can be unavailable
 * (private mode, blocked site data), so every access is guarded and the app
 * must keep working without persistence.
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // persistence unavailable; the session lives in memory for this tab
  }
}

export async function deleteItem(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}
