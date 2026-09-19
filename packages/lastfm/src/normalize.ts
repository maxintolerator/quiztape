import type { RecentTrack, RecentTrackArtist } from './types';

/** Last.fm returns one-element pages as a bare object; make everything an array. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Empty string MBIDs are Last.fm's way of saying "unknown"; treat them as null. */
export function mbidOrNull(mbid: string | undefined | null): string | null {
  if (!mbid) return null;
  const trimmed = mbid.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function artistName(artist: RecentTrackArtist): string {
  return 'name' in artist ? artist.name : artist['#text'];
}

export interface NormalizedScrobble {
  /** Unix seconds as reported by Last.fm. */
  playedAtUts: number;
  artistName: string;
  artistMbid: string | null;
  trackName: string;
  trackMbid: string | null;
  albumName: string | null;
  albumMbid: string | null;
  /** Only meaningful when fetched with `extended=1`; null otherwise. */
  loved: boolean | null;
}

/**
 * Convert a raw recenttracks row into a scrobble. Returns null for the
 * "now playing" pseudo-row (no date) so it is never stored as a play.
 */
export function normalizeRecentTrack(track: RecentTrack): NormalizedScrobble | null {
  if (track['@attr']?.nowplaying === 'true' || !track.date) return null;
  const uts = Number(track.date.uts);
  if (!Number.isFinite(uts) || uts <= 0) return null;
  return {
    playedAtUts: uts,
    artistName: artistName(track.artist),
    artistMbid: mbidOrNull(track.artist.mbid),
    trackName: track.name,
    trackMbid: mbidOrNull(track.mbid),
    albumName: track.album['#text'] ? track.album['#text'] : null,
    albumMbid: mbidOrNull(track.album.mbid),
    loved: track.loved === undefined ? null : track.loved === '1',
  };
}
