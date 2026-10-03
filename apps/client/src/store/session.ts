import type { MeResponse } from '@quiztape/shared';
import { create } from 'zustand';

import { api, ApiError } from '@/lib/api';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { useLibrary } from '@/store/library';

const TOKEN_KEY = 'quiztape.session';

export interface SessionUser {
  id: string;
  lastfmUsername: string;
  lastfmUrl: string | null;
  realName: string | null;
}

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

interface SessionState {
  status: SessionStatus;
  token: string | null;
  user: SessionUser | null;
  /** The app's Last.fm API key, handed out by the API once signed in; null while the API is unreachable. */
  lastfmApiKey: string | null;
  /** Read the stored token and confirm it with the API. Safe to call more than once. */
  hydrate: () => Promise<void>;
  /** Swap a one-time exchange code (from the auth redirect) for a session. */
  exchangeCode: (code: string) => Promise<void>;
  /** The API rejected the token: drop the session without calling it again. */
  expire: () => Promise<void>;
  signOut: () => Promise<void>;
}

let hydrating: Promise<void> | null = null;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  token: null,
  user: null,
  lastfmApiKey: null,

  hydrate: () => {
    if (hydrating) return hydrating;
    hydrating = (async () => {
      const token = await getItem(TOKEN_KEY);
      if (!token) {
        set({ status: 'anonymous', token: null, user: null, lastfmApiKey: null });
        return;
      }
      try {
        const me = await api<MeResponse>('/v1/me', { token });
        set({ status: 'authenticated', token, user: me.user, lastfmApiKey: me.lastfm.apiKey });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await get().expire();
        } else {
          // Offline or API down: keep the token and let screens show an error state.
          set({ status: 'authenticated', token, user: get().user });
        }
      }
    })().finally(() => {
      hydrating = null;
    });
    return hydrating;
  },

  exchangeCode: async (code) => {
    const { token, user } = await api<{ token: string; user: SessionUser }>('/v1/auth/exchange', {
      method: 'POST',
      body: { code },
    });
    await setItem(TOKEN_KEY, token);
    set({ status: 'authenticated', token, user, lastfmApiKey: null });
    // The exchange answers with the user only; /v1/me adds the Last.fm key the library needs.
    if (hydrating) await hydrating;
    await get().hydrate();
  },

  expire: async () => {
    await deleteItem(TOKEN_KEY);
    useLibrary.getState().close();
    set({ status: 'anonymous', token: null, user: null, lastfmApiKey: null });
  },

  signOut: async () => {
    const { token } = get();
    if (token) {
      try {
        await api('/v1/auth/logout', { method: 'POST', token });
      } catch {
        // best effort; the local session is cleared regardless
      }
    }
    await get().expire();
  },
}));
