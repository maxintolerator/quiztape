import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { API_URL } from './config';

export type ConnectResult = { type: 'code'; code: string } | { type: 'cancelled' } | { type: 'error'; error: string };

/**
 * Native: open the API's start URL in an auth session. The API redirects to
 * Last.fm, Last.fm back to the API, and the API finally to
 * quiztape://auth/callback?code=..., which closes the session and lands here.
 * Requires a development build; Expo Go cannot receive the custom scheme.
 */
export async function startConnect(): Promise<ConnectResult> {
  const returnTo = Linking.createURL('auth/callback');
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const startUrl = `${API_URL}/v1/auth/lastfm/start?platform=${platform}&return_to=${encodeURIComponent(returnTo)}`;
  const result = await WebBrowser.openAuthSessionAsync(startUrl, returnTo);
  if (result.type !== 'success') return { type: 'cancelled' };
  const { queryParams } = Linking.parse(result.url);
  const code = queryParams?.code;
  const error = queryParams?.error;
  if (typeof code === 'string' && code) return { type: 'code', code };
  return { type: 'error', error: typeof error === 'string' ? error : 'no_code' };
}
