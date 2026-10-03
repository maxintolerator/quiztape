import { MIN_PLAYS_FOR_QUESTIONS } from './rounds';

/**
 * The listening library lives on the player's device, not on the server. The
 * client downloads the history from Last.fm, keeps it locally as
 * `LocalScrobble` rows, and boils it down to a `StatsSnapshot`: the only part
 * of the history the API ever sees, sent along with each request that needs it.
 */

/** One play as kept on the device. A tuple, so 150,000 of them stay compact as JSON. */
export type LocalScrobble = [playedAtUts: number, artist: string, track: string, album: string | null, artistMbid: string | null];

/** Artists in a snapshot, most played first. Everything below 50 plays is already excluded. */
export const SNAPSHOT_MAX_ARTISTS = 1000;
/** Top tracks and albums kept per artist: the winner and the runner-up it has to beat. */
export const SNAPSHOT_TOP_ITEMS = 2;
/** Track keys kept per trivia artist, so Side B can prefer songs the player knows. */
export const SNAPSHOT_PLAYED_TRACKS = 60;
/** Band facts are fetched for this many of a player's most played artists. */
export const TRIVIA_ARTIST_CAP = 50;
/**
 * Last.fm (as Audioscrobbler) started in 2002. Plays dated before that, or in
 * the future, come from a device with a wrong clock: they still count as
 * plays, but say nothing about when something was first heard or which year
 * it belongs to.
 */
export const EARLIEST_PLAUSIBLE_PLAY_UTS = 1_009_843_200; // 2002-01-01T00:00:00Z
const CLOCK_SKEW_SECONDS = 86_400;

export function isPlausiblePlayTime(uts: number, nowMs: number = Date.now()): boolean {
  return uts >= EARLIEST_PLAUSIBLE_PLAY_UTS && uts <= Math.floor(nowMs / 1000) + CLOCK_SKEW_SECONDS;
}

export interface SnapshotItem {
  key: string;
  name: string;
  plays: number;
}

export interface SnapshotArtist extends SnapshotItem {
  /** Unix seconds; 0 when none of the artist's plays carries a believable date. */
  firstPlayedAt: number;
  lastPlayedAt: number;
  distinctTracks: number;
  distinctAlbums: number;
  /** The MBID Last.fm attached most often to this artist's plays; a hint, never trusted blindly. */
  mbidHint: string | null;
  topTracks: SnapshotItem[];
  topAlbums: SnapshotItem[];
  /** Most played track keys; filled for the trivia artists only. */
  playedTrackKeys: string[];
}

export interface SnapshotYear {
  year: number;
  /** The year's most played artists, winner first. */
  top: SnapshotItem[];
}

export interface StatsSnapshot {
  version: 1;
  scrobbleCount: number;
  /** Distinct artists in the whole library, including those too thin to be asked about. */
  artistCount: number;
  /** Unix seconds, from plays with a believable date; null when there are none. */
  oldestPlayedAt: number | null;
  newestPlayedAt: number | null;
  artists: SnapshotArtist[];
  years: SnapshotYear[];
}

/** What the API needs to know about an artist to fetch band facts for it. */
export interface LibraryArtistRef {
  name: string;
  rank: number;
  mbidHint: string | null;
}

export interface AnnounceLibraryRequest {
  artists: LibraryArtistRef[];
}

export interface TriviaStatusRequest {
  artistKeys: string[];
}

/** Normalise a Last.fm name/title for keys: case-insensitive, whitespace-collapsed. */
export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The fields of a Last.fm `recenttracks` row the library reads. `extended=1` swaps the artist's `#text` for `name`. */
export interface RawRecentTrack {
  artist: { '#text'?: string; name?: string; mbid?: string };
  name: string;
  album?: { '#text'?: string };
  /** Absent on the "now playing" pseudo-row. */
  date?: { uts: string };
  '@attr'?: { nowplaying?: string };
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns null for the "now playing" pseudo-row and for rows without a usable date or names. */
export function scrobbleFromRecentTrack(track: RawRecentTrack): LocalScrobble | null {
  if (track['@attr']?.nowplaying === 'true' || !track.date) return null;
  const uts = Number(track.date.uts);
  if (!Number.isFinite(uts) || uts <= 0) return null;
  const artist = track.artist.name ?? track.artist['#text'] ?? '';
  if (!artist.trim() || !track.name?.trim()) return null;
  const mbid = track.artist.mbid?.trim() ?? '';
  return [uts, artist, track.name, track.album?.['#text'] || null, MBID.test(mbid) ? mbid.toLowerCase() : null];
}

export interface SnapshotOptions {
  /** Calendar year of a play. Defaults to the device's time zone. */
  yearOf?: ((uts: number) => number) | undefined;
  /** Milliseconds since the epoch; plays dated later than this are treated as undated. Defaults to the current time. */
  now?: number | undefined;
}

interface ItemAcc {
  key: string;
  name: string;
  nameAt: number;
  plays: number;
  first: number;
}

interface ArtistAcc extends ItemAcc {
  last: number;
  tracks: Map<string, ItemAcc>;
  albums: Map<string, ItemAcc>;
  mbids: Map<string, number>;
}

/** Most played first; earlier first play, then key, break ties so ranks are stable. Undated items (`first` = Infinity) sort last among equals. */
function byPlays(a: ItemAcc, b: ItemAcc): number {
  return b.plays - a.plays || (a.first === b.first ? 0 : a.first < b.first ? -1 : 1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Count a play. Only a play with a believable date (`dated`) can move the first-play date or the spelling. */
function bump<T extends ItemAcc>(map: Map<string, T>, key: string, name: string, uts: number, dated: boolean, create: (base: ItemAcc) => T): T {
  let item = map.get(key);
  if (!item) {
    item = create({ key, name, nameAt: -Infinity, plays: 0, first: Infinity });
    map.set(key, item);
  }
  item.plays++;
  if (dated) {
    if (uts < item.first) item.first = uts;
    // The spelling of the most recent play wins.
    if (uts >= item.nameAt) {
      item.name = name;
      item.nameAt = uts;
    }
  }
  return item;
}

const toItem = (item: ItemAcc): SnapshotItem => ({ key: item.key, name: item.name, plays: item.plays });

/**
 * Boil a history down to what the question engine needs. Duplicate plays
 * (same second, artist and track; Last.fm repeats rows across pages) count once.
 */
export function buildStatsSnapshot(scrobbles: Iterable<LocalScrobble>, options: SnapshotOptions = {}): StatsSnapshot {
  const yearOf = options.yearOf ?? ((uts: number) => new Date(uts * 1000).getFullYear());
  const now = options.now ?? Date.now();
  const artists = new Map<string, ArtistAcc>();
  const years = new Map<number, Map<string, ItemAcc>>();
  const seen = new Set<string>();
  let scrobbleCount = 0;
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const [uts, artistName, trackName, albumName, mbid] of scrobbles) {
    const artistKey = nameKey(artistName);
    const trackKey = nameKey(trackName);
    const id = `${uts}\n${artistKey}\n${trackKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    scrobbleCount++;
    const dated = isPlausiblePlayTime(uts, now);

    const artist = bump(artists, artistKey, artistName, uts, dated, (base) => ({ ...base, last: -Infinity, tracks: new Map(), albums: new Map(), mbids: new Map() }));
    bump(artist.tracks, trackKey, trackName, uts, dated, (base) => base);
    if (albumName) bump(artist.albums, nameKey(albumName), albumName, uts, dated, (base) => base);
    if (mbid) artist.mbids.set(mbid, (artist.mbids.get(mbid) ?? 0) + 1);
    if (!dated) continue;

    if (uts > artist.last) artist.last = uts;
    if (oldest === null || uts < oldest) oldest = uts;
    if (newest === null || uts > newest) newest = uts;
    const year = yearOf(uts);
    let inYear = years.get(year);
    if (!inYear) {
      inYear = new Map();
      years.set(year, inYear);
    }
    bump(inYear, artistKey, artistName, uts, true, (base) => base);
  }

  const ranked = [...artists.values()].sort(byPlays);
  const eligible = ranked.filter((a) => a.plays >= MIN_PLAYS_FOR_QUESTIONS).slice(0, SNAPSHOT_MAX_ARTISTS);

  return {
    version: 1,
    scrobbleCount,
    artistCount: ranked.length,
    oldestPlayedAt: oldest,
    newestPlayedAt: newest,
    artists: eligible.map((artist, index) => {
      const tracks = [...artist.tracks.values()].sort(byPlays);
      const albums = [...artist.albums.values()].sort(byPlays);
      const [mbidHint] = [...artist.mbids.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? [null];
      return {
        ...toItem(artist),
        firstPlayedAt: Number.isFinite(artist.first) ? artist.first : 0,
        lastPlayedAt: Number.isFinite(artist.last) ? artist.last : 0,
        distinctTracks: tracks.length,
        distinctAlbums: albums.length,
        mbidHint,
        topTracks: tracks.slice(0, SNAPSHOT_TOP_ITEMS).map(toItem),
        topAlbums: albums.slice(0, SNAPSHOT_TOP_ITEMS).map(toItem),
        playedTrackKeys: index < TRIVIA_ARTIST_CAP ? tracks.slice(0, SNAPSHOT_PLAYED_TRACKS).map((t) => t.key) : [],
      };
    }),
    years: [...years.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, inYear]) => ({
        year,
        top: [...inYear.values()]
          .sort(byPlays)
          .slice(0, SNAPSHOT_TOP_ITEMS)
          // The artist's current spelling, not the one used that year.
          .map((item) => ({ key: item.key, name: artists.get(item.key)?.name ?? item.name, plays: item.plays })),
      })),
  };
}

/** The artists band facts are fetched for: the most played, capped. */
export function triviaArtistsOf(snapshot: StatsSnapshot): LibraryArtistRef[] {
  return snapshot.artists.slice(0, TRIVIA_ARTIST_CAP).map((artist, index) => ({ name: artist.name, rank: index + 1, mbidHint: artist.mbidHint }));
}

// ------------------------------------------------------------------ history file

export const HISTORY_FILE_FORMAT = 'quiztape-history';

/** The downloadable copy of a library, and what "load from file" accepts. */
export interface HistoryFile {
  format: typeof HISTORY_FILE_FORMAT;
  version: 1;
  username: string;
  exportedAt: string;
  scrobbles: LocalScrobble[];
}

export function toHistoryFile(username: string, scrobbles: LocalScrobble[], now: Date = new Date()): HistoryFile {
  return { format: HISTORY_FILE_FORMAT, version: 1, username, exportedAt: now.toISOString(), scrobbles };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1000;

/** Parse and validate a history file. Returns null when it is not one; malformed rows are dropped. */
export function parseHistoryFile(text: string): HistoryFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const file = data as Partial<HistoryFile>;
  if (file.format !== HISTORY_FILE_FORMAT || file.version !== 1 || !isText(file.username) || !Array.isArray(file.scrobbles)) return null;
  const scrobbles: LocalScrobble[] = [];
  for (const row of file.scrobbles as unknown[]) {
    if (!Array.isArray(row)) continue;
    const [uts, artist, track, album, mbid] = row as unknown[];
    if (typeof uts !== 'number' || !Number.isInteger(uts) || uts <= 0 || !isText(artist) || !isText(track)) continue;
    scrobbles.push([uts, artist, track, isText(album) ? album : null, typeof mbid === 'string' && MBID.test(mbid) ? mbid.toLowerCase() : null]);
  }
  return { format: HISTORY_FILE_FORMAT, version: 1, username: file.username, exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '', scrobbles };
}
