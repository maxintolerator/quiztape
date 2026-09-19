import { create } from 'zustand';

import { api, ApiError } from '@/lib/api';
import { deleteItem, getItem, setItem } from '@/lib/storage';

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
  /** Read the stored token and confirm it with the API. Safe to call more than once. */
  hydrate: () => Promise<void>;
  /** Swap a one-time exchange code (from the auth redirect) for a session. */
  exchangeCode: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

let hydrating: Promise<void> | null = null;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  token: null,
  user: null,

  hydrate: () => {
    if (hydrating) return hydrating;
    hydrating = (async () => {
      const token = await getItem(TOKEN_KEY);
      if (!token) {
        set({ status: 'anonymous', token: null, user: null });
        return;
      }
      try {
        const { user } = await api<{ user: SessionUser }>('/v1/me', { token });
        set({ status: 'authenticated', token, user });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await deleteItem(TOKEN_KEY);
          set({ status: 'anonymous', token: null, user: null });
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
    set({ status: 'authenticated', token, user });
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
    await deleteItem(TOKEN_KEY);
    set({ status: 'anonymous', token: null, user: null });
  },
}));
