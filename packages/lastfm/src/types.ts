/**
 * Raw Last.fm JSON shapes. Field names mirror the API verbatim (including
 * `#text` and `@attr`) so the client stays a thin, honest wrapper; the
 * normalizers in ./normalize turn these into app types.
 */

export interface LastfmImage {
  size: 'small' | 'medium' | 'large' | 'extralarge' | 'mega' | '';
  '#text': string;
}

export interface LastfmSession {
  name: string;
  key: string;
  subscriber: number | string;
}

export interface PageAttr {
  user: string;
  totalPages: string;
  page: string;
  perPage: string;
  total: string;
}

/** Artist as embedded in recenttracks; `extended=1` swaps `#text` for `name`. */
export type RecentTrackArtist =
  | { '#text': string; mbid: string }
  | { name: string; mbid: string; url: string; image: LastfmImage[] };

export interface RecentTrack {
  artist: RecentTrackArtist;
  name: string;
  mbid: string;
  url: string;
  streamable: string;
  album: { '#text': string; mbid: string };
  image: LastfmImage[];
  /** Absent on the "now playing" pseudo-row. */
  date?: { uts: string; '#text': string };
  /** Only present with `extended=1`. */
  loved?: '0' | '1';
  '@attr'?: { nowplaying: 'true' };
}

export interface RecentTracksResponse {
  recenttracks: {
    /** A single-item page is returned as an object, not a one-element array. */
    track: RecentTrack[] | RecentTrack;
    '@attr': PageAttr;
  };
}

export type Period = 'overall' | '7day' | '1month' | '3month' | '6month' | '12month';

export interface TopArtist {
  name: string;
  mbid: string;
  url: string;
  playcount: string;
  streamable: string;
  image: LastfmImage[];
  '@attr': { rank: string };
}

export interface TopArtistsResponse {
  topartists: { artist: TopArtist[] | TopArtist; '@attr': PageAttr };
}

export interface TopAlbum {
  name: string;
  mbid: string;
  url: string;
  playcount: string;
  artist: { name: string; mbid: string; url: string };
  image: LastfmImage[];
  '@attr': { rank: string };
}

export interface TopAlbumsResponse {
  topalbums: { album: TopAlbum[] | TopAlbum; '@attr': PageAttr };
}

export interface TopTrack {
  name: string;
  mbid: string;
  url: string;
  playcount: string;
  duration: string;
  artist: { name: string; mbid: string; url: string };
  streamable: { fulltrack: string; '#text': string };
  image: LastfmImage[];
  '@attr': { rank: string };
}

export interface TopTracksResponse {
  toptracks: { track: TopTrack[] | TopTrack; '@attr': PageAttr };
}

export interface UserInfoResponse {
  user: {
    name: string;
    realname: string;
    url: string;
    country: string;
    age: string;
    gender: string;
    subscriber: string;
    playcount: string;
    artist_count?: string;
    track_count?: string;
    album_count?: string;
    playlists: string;
    bootstrap: string;
    registered: { unixtime: string; '#text': number | string };
    type: string;
    image: LastfmImage[];
  };
}

export type RecentTracksParams = {
  user: string;
  /** 1-based. */
  page?: number | undefined;
  /** Max 200. */
  limit?: number | undefined;
  /** Unix seconds, inclusive lower bound. */
  from?: number | undefined;
  /** Unix seconds, exclusive upper bound. */
  to?: number | undefined;
  /** Adds `loved` and a richer artist object. */
  extended?: boolean | undefined;
};

export type TopParams = {
  user: string;
  period?: Period | undefined;
  page?: number | undefined;
  /** Max 1000 for top charts. */
  limit?: number | undefined;
};
