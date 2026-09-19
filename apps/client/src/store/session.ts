import type { MeResponse, SyncSummary } from '@quiztape/shared';
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
  /** Latest known sync state; null until fetched. Drives the sync screen and the auth gate. */
  sync: SyncSummary | null;
  /** Read the stored token and confirm it with the API. Safe to call more than once. */
  hydrate: () => Promise<void>;
  /** Swap a one-time exchange code (from the auth redirect) for a session. */
  exchangeCode: (code: string) => Promise<void>;
  /** Fetch the sync state; returns null when the API is unreachable. */
  refreshSync: () => Promise<SyncSummary | null>;
  /** Ask the API to queue a backfill or incremental sync. */
  requestSync: () => Promise<void>;
  signOut: () => Promise<void>;
}

let hydrating: Promise<void> | null = null;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  token: null,
  user: null,
  sync: null,

  hydrate: () => {
    if (hydrating) return hydrating;
    hydrating = (async () => {
      const token = await getItem(TOKEN_KEY);
      if (!token) {
        set({ status: 'anonymous', token: null, user: null, sync: null });
        return;
      }
      try {
        const me = await api<MeResponse>('/v1/me', { token });
        set({ status: 'authenticated', token, user: me.user, sync: me.sync });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await deleteItem(TOKEN_KEY);
          set({ status: 'anonymous', token: null, user: null, sync: null });
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
    set({ status: 'authenticated', token, user, sync: null });
  },

  refreshSync: async () => {
    const { token } = get();
    if (!token) return null;
    try {
      const sync = await api<SyncSummary>('/v1/me/sync', { token });
      set({ sync });
      return sync;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await deleteItem(TOKEN_KEY);
        set({ status: 'anonymous', token: null, user: null, sync: null });
      }
      return null;
    }
  },

  requestSync: async () => {
    const { token } = get();
    if (!token) return;
    await api('/v1/me/sync/refresh', { method: 'POST', token });
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
    set({ status: 'anonymous', token: null, user: null, sync: null });
  },
}));
