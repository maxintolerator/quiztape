import * as SecureStore from 'expo-secure-store';

/**
 * Native implementation: iOS Keychain / Android Keystore. Values must stay
 * small (some iOS releases rejected values over ~2 KB); we store a single token.
 * The web implementation lives in storage.web.ts (see docs/PLATFORMS.md).
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // already gone
  }
}
