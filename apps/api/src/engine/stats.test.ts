import type { SnapshotArtist, StatsSnapshot } from '@quiztape/shared';
import { describe, expect, it } from 'vitest';

import { StatsSnapshotSchema, engineStats } from './stats';

const artist = (name: string, plays: number, firstPlayedAt = 1_600_000_000, extra: Partial<SnapshotArtist> = {}): SnapshotArtist => ({
  key: 'whatever-the-device-says',
  name,
  plays,
  firstPlayedAt,
  lastPlayedAt: firstPlayedAt + 1,
  distinctTracks: 5,
  distinctAlbums: 2,
  mbidHint: null,
  topTracks: [],
  topAlbums: [],
  playedTrackKeys: [],
  ...extra,
});

const snapshot = (artists: SnapshotArtist[], years: StatsSnapshot['years'] = []): StatsSnapshot => ({
  version: 1,
  scrobbleCount: 1000,
  artistCount: artists.length,
  oldestPlayedAt: 1_500_000_000,
  newestPlayedAt: 1_700_000_000,
  artists,
  years,
});

describe('engineStats', () => {
  it('derives keys, ranks and difficulty itself instead of trusting the device', () => {
    const stats = engineStats(
      snapshot([
        artist('Thin', 49),
        artist('  Second  Place ', 200, 1_600_000_500),
        artist('Tied But Earlier', 200, 1_600_000_100),
        artist('First', 900),
        artist('FIRST', 60), // same artist under another spelling: the first entry wins
      ]),
    );
    expect(stats.artists.map((a) => [a.artistKey, a.rank, a.difficulty])).toEqual([
      ['first', 1, 'easy'],
      ['tied but earlier', 2, 'easy'],
      ['second place', 3, 'easy'],
    ]);
    expect(stats.builtThrough?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('orders top items and year charts by plays whatever order they arrive in', () => {
    const stats = engineStats(
      snapshot(
        [artist('Radiohead', 300, 1_600_000_000, { topTracks: [{ key: 'x', name: 'Lucky', plays: 10 }, { key: 'y', name: 'Airbag', plays: 40 }], playedTrackKeys: ['  AIRBAG ', 'lucky'] })],
        [{ year: 2020, top: [{ key: 'b', name: 'Burial', plays: 55 }, { key: 'a', name: 'Autechre', plays: 60 }] }, { year: 2021, top: [] }],
      ),
    );
    expect(stats.artists[0]!.topTracks).toEqual([{ key: 'airbag', name: 'Airbag', playCount: 40 }, { key: 'lucky', name: 'Lucky', playCount: 10 }]);
    expect([...stats.artists[0]!.playedTrackKeys]).toEqual(['airbag', 'lucky']);
    expect(stats.years).toEqual([{ year: 2020, first: { key: 'autechre', name: 'Autechre', playCount: 60 }, second: { key: 'burial', name: 'Burial', playCount: 55 } }]);
  });
});

describe('StatsSnapshotSchema', () => {
  it('accepts a real snapshot and rejects oversized or malformed ones', () => {
    expect(StatsSnapshotSchema.safeParse(snapshot([artist('Radiohead', 300)])).success).toBe(true);
    expect(StatsSnapshotSchema.safeParse(snapshot(Array.from({ length: 1001 }, (_, i) => artist(`A${i}`, 60)))).success).toBe(false);
    expect(StatsSnapshotSchema.safeParse(snapshot([artist('Radiohead', -1)])).success).toBe(false);
    expect(StatsSnapshotSchema.safeParse({ ...snapshot([]), version: 2 }).success).toBe(false);
    expect(StatsSnapshotSchema.safeParse(snapshot([artist('x'.repeat(2_001), 300)])).success).toBe(false);
  });

  it('accepts what real libraries contain: plays dated 1970, very long titles, malformed MBIDs', () => {
    const longTitle = 'When the Pawn Hits the Conflicts He Thinks Like a King '.repeat(8).trim(); // 439 characters
    const odd = snapshot(
      [
        artist('Fiona Apple', 300, 1_600_000_000, { topAlbums: [{ key: longTitle.toLowerCase(), name: longTitle, plays: 200 }], mbidHint: '12345678-1234-1234-1234-123456789abc' }),
        artist('Clockless', 200, 0, { lastPlayedAt: 0, mbidHint: 'not-an-mbid' }),
        artist('Radiohead', 100, 1_600_000_000, { mbidHint: 'A74B1B7F-71A5-4011-9441-D0B5E4122711' }),
      ],
      [{ year: 1970, top: [{ key: 'clockless', name: 'Clockless', plays: 200 }] }, { year: 2020, top: [{ key: 'fiona apple', name: 'Fiona Apple', plays: 300 }] }],
    );
    const parsed = StatsSnapshotSchema.safeParse({ ...odd, oldestPlayedAt: 0, newestPlayedAt: 4_000_000_000 });
    expect(parsed.success).toBe(true);
    // Hints that are not well-formed UUIDs become "no hint"; good ones are lower-cased.
    expect(parsed.data!.artists.map((a) => a.mbidHint)).toEqual([null, null, 'a74b1b7f-71a5-4011-9441-d0b5e4122711']);

    const stats = engineStats(parsed.data!);
    expect(stats.years.map((y) => y.year)).toEqual([2020]);
    expect(stats.artists.map((a) => [a.artistName, a.firstPlayedAt?.toISOString() ?? null])).toEqual([
      ['Fiona Apple', '2020-09-13T12:26:40.000Z'],
      ['Clockless', null],
      ['Radiohead', '2020-09-13T12:26:40.000Z'],
    ]);
    expect(stats.builtThrough).toBeNull(); // a newest play in 2096 is not believable either
  });
});
