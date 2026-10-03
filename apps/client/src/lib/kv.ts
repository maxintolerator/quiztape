import Storage from 'expo-sqlite/kv-store';

/**
 * Device key-value store for the listening library. Native implementation:
 * SQLite through expo-sqlite's kv-store, which has no size ceiling (a big
 * library is 10 MB or more). The web implementation lives in kv.web.ts
 * (see docs/PLATFORMS.md).
 */
export async function kvGet(key: string): Promise<string | null> {
  try {
    return await Storage.getItem(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  await Storage.setItem(key, value);
}

export async function kvDelete(key: string): Promise<void> {
  try {
    await Storage.removeItem(key);
  } catch {
    // already gone
  }
}

export async function kvKeys(prefix: string): Promise<string[]> {
  try {
    return (await Storage.getAllKeys()).filter((key) => key.startsWith(prefix));
  } catch {
    return [];
  }
}

/** Whether what is written survives a restart. Always true on native. */
export function kvIsPersistent(): boolean {
  return true;
}
