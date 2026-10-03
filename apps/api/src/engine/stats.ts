import {
  type Difficulty,
  EARLIEST_PLAUSIBLE_PLAY_UTS,
  MIN_PLAYS_FOR_QUESTIONS,
  SNAPSHOT_MAX_ARTISTS,
  type StatsSnapshot,
  difficultyFor,
  nameKey,
} from '@quiztape/shared';
import { z } from 'zod';

/** Real titles run long (one Fiona Apple album is 444 characters), so the limit only guards against abuse. */
const name = z.string().min(1).max(2_000);
const count = z.number().int().min(0).max(1_000_000_000);
/** Unix seconds. Devices with a wrong clock produce dates from 1970 to far in the future; `engineStats` decides what is believable. */
const uts = z.number().int().min(0).max(100_000_000_000);
const item = z.object({ key: name, name, plays: count });
const RFC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Last.fm's MBIDs are hints of mixed quality. Anything that is not a well-formed UUID becomes "no hint" instead of failing the request. */
export const MbidHint = z
  .string()
  .max(100)
  .nullable()
  .transform((value) => (value && RFC_UUID.test(value) ? value.toLowerCase() : null));

/**
 * The library arrives from the player's device with every request that needs
 * it. This schema bounds sizes and types so a request stays small; it does
 * not judge the data, because real libraries are full of oddities (plays
 * dated 1970, very long titles, malformed MBIDs) and a rejected snapshot
 * locks the player out. `engineStats` re-derives keys, ranks and difficulty
 * and ignores what is not believable.
 */
export const StatsSnapshotSchema = z.object({
  version: z.literal(1),
  scrobbleCount: count,
  artistCount: count,
  oldestPlayedAt: uts.nullable(),
  newestPlayedAt: uts.nullable(),
  artists: z
    .array(
      item.extend({
        firstPlayedAt: uts,
        lastPlayedAt: uts,
        distinctTracks: count,
        distinctAlbums: count,
        mbidHint: MbidHint,
        topTracks: z.array(item).max(5),
        topAlbums: z.array(item).max(5),
        playedTrackKeys: z.array(name).max(100),
      }),
    )
    .max(SNAPSHOT_MAX_ARTISTS),
  years: z.array(z.object({ year: z.number().int().min(0).max(9_999), top: z.array(item).max(5) })).max(300),
}) satisfies z.ZodType<StatsSnapshot, unknown>;

/** One line a player can read (and report) when a request body is refused. */
export function describeIssues(error: z.ZodError): string {
  const [issue] = error.issues;
  return issue ? `The request was not accepted (${issue.path.join('.') || 'body'}: ${issue.message}).` : 'The request was not accepted.';
}

export interface EngineItem {
  key: string;
  name: string;
  playCount: number;
}

/** An artist the player can be asked about, as the generators see it. */
export interface EngineArtist {
  artistKey: string;
  artistName: string;
  playCount: number;
  rank: number;
  difficulty: Difficulty;
  /** Null when none of the artist's plays carries a believable date. */
  firstPlayedAt: Date | null;
  distinctTracks: number;
  distinctAlbums: number;
  mbidHint: string | null;
  /** Most played first. */
  topTracks: EngineItem[];
  topAlbums: EngineItem[];
  playedTrackKeys: ReadonlySet<string>;
}

export interface EngineYear {
  year: number;
  first: EngineItem;
  second: EngineItem | null;
}

export interface EngineStats {
  /** Artists with enough plays to be asked about, in rank order. */
  artists: EngineArtist[];
  years: EngineYear[];
  /** The newest play the snapshot covers. */
  builtThrough: Date | null;
}

const EARLIEST_YEAR = new Date(EARLIEST_PLAUSIBLE_PLAY_UTS * 1000).getUTCFullYear();
/** Dated after Last.fm existed and not in the future (a day of slack for clocks and time zones). */
const believable = (seconds: number) => seconds >= EARLIEST_PLAUSIBLE_PLAY_UTS && seconds <= Date.now() / 1000 + 86_400;
const toItem = (value: { name: string; plays: number }): EngineItem => ({ key: nameKey(value.name), name: value.name, playCount: value.plays });
const byPlays = (a: EngineItem, b: EngineItem) => b.playCount - a.playCount;
/** Undated artists sort after dated ones with the same play count, as on the device. */
const firstPlay = (artist: { firstPlayedAt: number }) => (believable(artist.firstPlayedAt) ? artist.firstPlayedAt : Number.MAX_SAFE_INTEGER);

/** Turn a validated snapshot into the engine's view: keys from names, ranks from play counts, difficulty from the shared rule. */
export function engineStats(snapshot: StatsSnapshot): EngineStats {
  const seen = new Set<string>();
  const eligible = snapshot.artists
    .map((artist) => ({ artist, key: nameKey(artist.name) }))
    .filter(({ artist, key }) => key.length > 0 && artist.plays >= MIN_PLAYS_FOR_QUESTIONS && !seen.has(key) && !!seen.add(key))
    .sort((a, b) => b.artist.plays - a.artist.plays || firstPlay(a.artist) - firstPlay(b.artist) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    artists: eligible.map(({ artist, key }, index) => ({
      artistKey: key,
      artistName: artist.name,
      playCount: artist.plays,
      rank: index + 1,
      difficulty: difficultyFor(index + 1, artist.plays),
      firstPlayedAt: believable(artist.firstPlayedAt) ? new Date(artist.firstPlayedAt * 1000) : null,
      distinctTracks: artist.distinctTracks,
      distinctAlbums: artist.distinctAlbums,
      mbidHint: artist.mbidHint,
      topTracks: artist.topTracks.map(toItem).sort(byPlays),
      topAlbums: artist.topAlbums.map(toItem).sort(byPlays),
      playedTrackKeys: new Set(artist.playedTrackKeys.map(nameKey)),
    })),
    years: snapshot.years
      .filter((entry) => entry.year >= EARLIEST_YEAR && entry.year <= new Date().getUTCFullYear() + 1)
      .map((entry) => ({ year: entry.year, top: entry.top.map(toItem).sort(byPlays) }))
      .filter((entry) => entry.top.length > 0)
      .map((entry) => ({ year: entry.year, first: entry.top[0]!, second: entry.top[1] ?? null })),
    builtThrough: snapshot.newestPlayedAt !== null && believable(snapshot.newestPlayedAt) ? new Date(snapshot.newestPlayedAt * 1000) : null,
  };
}
