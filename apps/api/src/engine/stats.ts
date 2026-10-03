import {
  type Difficulty,
  MIN_PLAYS_FOR_QUESTIONS,
  SNAPSHOT_MAX_ARTISTS,
  type StatsSnapshot,
  difficultyFor,
  nameKey,
} from '@quiztape/shared';
import { z } from 'zod';

const name = z.string().min(1).max(300);
const count = z.number().int().min(0).max(100_000_000);
/** Unix seconds, up to the year 2100. */
const uts = z.number().int().min(0).max(4_102_444_800);
const item = z.object({ key: name, name, plays: count });

/**
 * The library arrives from the player's device with every request that needs
 * it. Bounded here so a request stays small, and re-derived in `engineStats`
 * so keys, ranks and difficulty never come from the client.
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
        mbidHint: z.string().uuid().nullable(),
        topTracks: z.array(item).max(5),
        topAlbums: z.array(item).max(5),
        playedTrackKeys: z.array(name).max(100),
      }),
    )
    .max(SNAPSHOT_MAX_ARTISTS),
  years: z.array(z.object({ year: z.number().int().min(1990).max(2100), top: z.array(item).max(5) })).max(120),
}) satisfies z.ZodType<StatsSnapshot>;

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
  firstPlayedAt: Date;
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

const toItem = (value: { name: string; plays: number }): EngineItem => ({ key: nameKey(value.name), name: value.name, playCount: value.plays });
const byPlays = (a: EngineItem, b: EngineItem) => b.playCount - a.playCount;

/** Turn a validated snapshot into the engine's view: keys from names, ranks from play counts, difficulty from the shared rule. */
export function engineStats(snapshot: StatsSnapshot): EngineStats {
  const seen = new Set<string>();
  const eligible = snapshot.artists
    .map((artist) => ({ artist, key: nameKey(artist.name) }))
    .filter(({ artist, key }) => key.length > 0 && artist.plays >= MIN_PLAYS_FOR_QUESTIONS && !seen.has(key) && !!seen.add(key))
    .sort((a, b) => b.artist.plays - a.artist.plays || a.artist.firstPlayedAt - b.artist.firstPlayedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    artists: eligible.map(({ artist, key }, index) => ({
      artistKey: key,
      artistName: artist.name,
      playCount: artist.plays,
      rank: index + 1,
      difficulty: difficultyFor(index + 1, artist.plays),
      firstPlayedAt: new Date(artist.firstPlayedAt * 1000),
      distinctTracks: artist.distinctTracks,
      distinctAlbums: artist.distinctAlbums,
      mbidHint: artist.mbidHint,
      topTracks: artist.topTracks.map(toItem).sort(byPlays),
      topAlbums: artist.topAlbums.map(toItem).sort(byPlays),
      playedTrackKeys: new Set(artist.playedTrackKeys.map(nameKey)),
    })),
    years: snapshot.years
      .map((entry) => ({ year: entry.year, top: entry.top.map(toItem).sort(byPlays) }))
      .filter((entry) => entry.top.length > 0)
      .map((entry) => ({ year: entry.year, first: entry.top[0]!, second: entry.top[1] ?? null })),
    builtThrough: snapshot.newestPlayedAt === null ? null : new Date(snapshot.newestPlayedAt * 1000),
  };
}
