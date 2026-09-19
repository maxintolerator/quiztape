import type { RecentTrack } from '@quiztape/lastfm';

import { jsonResponse } from './testing';

/**
 * Scripted Last.fm for tests: answers auth.getSession, user.getInfo and a
 * paginated user.getRecentTracks from an in-memory history.
 */
export interface FakeLastfmOptions {
  username?: string;
  sessionKey?: string;
  history?: RecentTrack[];
  nowPlaying?: RecentTrack | null;
  perPage?: number;
  /** Fail user.getRecentTracks with this Last.fm error code once per call until cleared. */
  recentTracksError?: number | null;
}

export function track(uts: number, artist: string, name: string, album: string | null = null): RecentTrack {
  return {
    artist: { name: artist, mbid: '', url: '', image: [] },
    name,
    mbid: '',
    url: '',
    streamable: '0',
    album: { '#text': album ?? '', mbid: '' },
    image: [],
    date: { uts: String(uts), '#text': new Date(uts * 1000).toISOString() },
    loved: '0',
  };
}

export function createFakeLastfm(options: FakeLastfmOptions = {}) {
  const state = {
    username: options.username ?? 'someone',
    sessionKey: options.sessionKey ?? 'a'.repeat(32),
    history: [...(options.history ?? [])].sort((a, b) => Number(b.date!.uts) - Number(a.date!.uts)),
    nowPlaying: options.nowPlaying ?? null,
    perPage: options.perPage ?? 200,
    recentTracksError: options.recentTracksError ?? null,
    calls: [] as URL[],
  };

  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (init?.method === 'POST' && typeof init.body === 'string') {
      for (const [key, value] of new URLSearchParams(init.body)) url.searchParams.set(key, value);
    }
    state.calls.push(url);
    const method = url.searchParams.get('method');
    switch (method) {
      case 'auth.getSession':
        if (url.searchParams.get('token') === 'BAD') return jsonResponse({ error: 14, message: 'This token has not been authorized' }, 403);
        return jsonResponse({ session: { name: state.username, key: state.sessionKey, subscriber: 0 } });
      case 'user.getInfo':
        return jsonResponse({
          user: {
            name: state.username,
            realname: 'Some One',
            url: `https://www.last.fm/user/${state.username}`,
            country: 'DE',
            playcount: String(state.history.length),
            registered: { unixtime: '1262304000', '#text': 1262304000 },
            image: [],
          },
        });
      case 'user.getRecentTracks': {
        if (state.recentTracksError) return jsonResponse({ error: state.recentTracksError, message: 'scripted error' }, 500);
        const page = Number(url.searchParams.get('page') ?? '1');
        const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), state.perPage);
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        let rows = state.history;
        if (from) rows = rows.filter((t) => Number(t.date!.uts) > Number(from));
        if (to) rows = rows.filter((t) => Number(t.date!.uts) < Number(to));
        const totalPages = Math.ceil(rows.length / limit);
        const slice = rows.slice((page - 1) * limit, page * limit);
        const withNowPlaying = page === 1 && state.nowPlaying ? [state.nowPlaying, ...slice] : slice;
        return jsonResponse({
          recenttracks: {
            track: withNowPlaying.length === 1 ? withNowPlaying[0] : withNowPlaying,
            '@attr': { user: state.username, page: String(page), perPage: String(limit), totalPages: String(totalPages), total: String(rows.length) },
          },
        });
      }
      default:
        return jsonResponse({ error: 3, message: `Invalid method ${method}` }, 400);
    }
  };

  return { fetch, state };
}
