import * as Linking from 'expo-linking';

import { API_URL } from './config';

export type ConnectResult = { type: 'code'; code: string } | { type: 'cancelled' } | { type: 'error'; error: string };

/**
 * Web: a full-page redirect through the API and Last.fm, returning to
 * /auth/callback?code=... on this origin, where the callback route finishes.
 * This never resolves in practice because the page navigates away.
 */
export async function startConnect(): Promise<ConnectResult> {
  const returnTo = Linking.createURL('/auth/callback');
  const startUrl = `${API_URL}/v1/auth/lastfm/start?platform=web&return_to=${encodeURIComponent(returnTo)}`;
  globalThis.location.assign(startUrl);
  return new Promise<ConnectResult>(() => {});
}
