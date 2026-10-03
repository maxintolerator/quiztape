/**
 * Saving the library as a file and loading it back. Native implementation:
 * not offered yet (see docs/PLATFORMS.md), so the screens hide the buttons.
 * The web implementation lives in history-file.web.ts.
 */
export const historyFileSupported = false;

export async function saveHistoryFile(_filename: string, _contents: string): Promise<void> {}

export async function pickHistoryFile(): Promise<string | null> {
  return null;
}
