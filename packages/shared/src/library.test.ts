import { describe, expect, it } from 'vitest';

import { type LocalScrobble, TRIVIA_ARTIST_CAP, buildStatsSnapshot, nameKey, parseHistoryFile, scrobbleFromRecentTrack, toHistoryFile, triviaArtistsOf } from './library';

const utcYear = (uts: number) => new Date(uts * 1000).getUTCFullYear();
const Y2020 = 1_577_836_800; // 2020-01-01T00:00:00Z
const Y2021 = 1_609_459_200;

/** `count` plays of one track, one minute apart, starting at `from`. */
function plays(from: number, count: number, artist: string, track: string, album: string | null = null, mbid: string | null = null): LocalScrobble[] {
  return Array.from({ length: count }, (_, i) => [from + i * 60, artist, track, album, mbid]);
}

describe('scrobbleFromRecentTrack', () => {
  it('reads both artist shapes and drops the now-playing row', () => {
    const base = { name: 'Roygbiv', album: { '#text': 'Music Has the Right to Children' }, date: { uts: '1600000000' } };
    expect(scrobbleFromRecentTrack({ ...base, artist: { '#text': 'Boards of Canada', mbid: '69158F97-4C07-4C4E-BAF8-4E4AB1ED666E' } })).toEqual([
      1_600_000_000,
      'Boards of Canada',
      'Roygbiv',
      'Music Has the Right to Children',
      '69158f97-4c07-4c4e-baf8-4e4ab1ed666e',
    ]);
    expect(scrobbleFromRecentTrack({ ...base, artist: { name: 'Boards of Canada', mbid: '' }, album: { '#text': '' } })).toEqual([1_600_000_000, 'Boards of Canada', 'Roygbiv', null, null]);
    expect(scrobbleFromRecentTrack({ name: 'Live', artist: { '#text': 'Someone' }, '@attr': { nowplaying: 'true' } })).toBeNull();
    expect(scrobbleFromRecentTrack({ ...base, artist: { '#text': '  ' } })).toBeNull();
  });
});

describe('buildStatsSnapshot', () => {
  it('returns an empty snapshot for an empty library', () => {
    expect(buildStatsSnapshot([])).toEqual({ version: 1, scrobbleCount: 0, artistCount: 0, oldestPlayedAt: null, newestPlayedAt: null, artists: [], years: [] });
  });

  it('counts a repeated row once and keys names case-insensitively', () => {
    const rows: LocalScrobble[] = [...plays(Y2020, 60, 'Radiohead', 'Airbag', 'OK Computer'), ...plays(Y2020, 60, 'radiohead ', 'AIRBAG', 'OK Computer')];
    const snapshot = buildStatsSnapshot(rows, { yearOf: utcYear });
    expect(snapshot.scrobbleCount).toBe(60);
    expect(snapshot.artists).toHaveLength(1);
    expect(snapshot.artists[0]).toMatchObject({ key: 'radiohead', plays: 60, distinctTracks: 1, distinctAlbums: 1 });
  });

  it('ranks artists by plays, breaks ties by first play, and leaves out artists under 50 plays', () => {
    const rows: LocalScrobble[] = [
      ...plays(Y2020 + 500_000, 70, 'Later', 'L'),
      ...plays(Y2020, 70, 'Earlier', 'E'),
      ...plays(Y2020 + 900_000, 90, 'Most', 'M'),
      ...plays(Y2020 + 100, 49, 'Thin', 'T'),
    ];
    const snapshot = buildStatsSnapshot(rows, { yearOf: utcYear });
    expect(snapshot.artists.map((a) => a.name)).toEqual(['Most', 'Earlier', 'Later']);
    expect(snapshot.artistCount).toBe(4);
    expect(snapshot.scrobbleCount).toBe(279);
    expect(snapshot.oldestPlayedAt).toBe(Y2020);
  });

  it('keeps the top two tracks and albums, the latest spelling, play dates and the commonest MBID hint', () => {
    const a = '69158f97-4c07-4c4e-baf8-4e4ab1ed666e';
    const b = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
    const rows: LocalScrobble[] = [
      ...plays(Y2020, 30, 'Bjork', 'Hyperballad', 'Post', a),
      ...plays(Y2020 + 10_000, 20, 'Björk', 'Jóga', 'Homogenic', b),
      ...plays(Y2020 + 20_000, 5, 'Björk', 'Army of Me', 'Post', b),
      ...plays(Y2020 + 30_000, 4, 'Björk', 'No Album Track', null, a),
    ];
    // "Bjork" and "Björk" are different keys; only the second spelling is one artist here.
    const snapshot = buildStatsSnapshot([...rows, ...plays(Y2020 + 40_000, 25, 'Björk', 'Jóga', 'Homogenic', b)], { yearOf: utcYear });
    const [bjork] = snapshot.artists;
    expect(snapshot.artists).toHaveLength(1);
    expect(bjork).toMatchObject({
      key: 'björk',
      name: 'Björk',
      plays: 54,
      firstPlayedAt: Y2020 + 10_000,
      lastPlayedAt: Y2020 + 40_000 + 24 * 60,
      distinctTracks: 3,
      distinctAlbums: 2,
      mbidHint: b,
      topTracks: [
        { key: 'jóga', name: 'Jóga', plays: 45 },
        { key: 'army of me', name: 'Army of Me', plays: 5 },
      ],
      topAlbums: [
        { key: 'homogenic', name: 'Homogenic', plays: 45 },
        { key: 'post', name: 'Post', plays: 5 },
      ],
    });
    expect(bjork!.playedTrackKeys).toEqual(['jóga', 'army of me', 'no album track']);
  });

  it('charts each year separately with the winner first', () => {
    const rows: LocalScrobble[] = [...plays(Y2020, 60, 'Autechre', 'Bike'), ...plays(Y2020 + 100_000, 55, 'Burial', 'Archangel'), ...plays(Y2021, 80, 'Burial', 'Archangel'), ...plays(Y2021 + 100_000, 3, 'Caribou', 'Sun')];
    const { years } = buildStatsSnapshot(rows, { yearOf: utcYear });
    expect(years).toEqual([
      { year: 2020, top: [{ key: 'autechre', name: 'Autechre', plays: 60 }, { key: 'burial', name: 'Burial', plays: 55 }] },
      { year: 2021, top: [{ key: 'burial', name: 'Burial', plays: 80 }, { key: 'caribou', name: 'Caribou', plays: 3 }] },
    ]);
  });

  it('caps the trivia artists and gives track keys only to them', () => {
    const rows = Array.from({ length: TRIVIA_ARTIST_CAP + 5 }, (_, i) => plays(Y2020 + i * 100_000, 200 - i, `Artist ${i}`, 'Song')).flat();
    const snapshot = buildStatsSnapshot(rows, { yearOf: utcYear });
    const refs = triviaArtistsOf(snapshot);
    expect(refs).toHaveLength(TRIVIA_ARTIST_CAP);
    expect(refs[0]).toEqual({ name: 'Artist 0', rank: 1, mbidHint: null });
    expect(snapshot.artists[TRIVIA_ARTIST_CAP - 1]!.playedTrackKeys).toEqual(['song']);
    expect(snapshot.artists[TRIVIA_ARTIST_CAP]!.playedTrackKeys).toEqual([]);
  });
});

describe('history file', () => {
  it('round-trips a library and drops malformed rows', () => {
    const rows = plays(Y2020, 2, 'Radiohead', 'Airbag', 'OK Computer');
    const file = toHistoryFile('someone', rows, new Date('2026-10-03T00:00:00Z'));
    expect(parseHistoryFile(JSON.stringify(file))).toEqual(file);
    const dirty = { ...file, scrobbles: [...rows, ['nope'], [Y2020, '', 'x', null, null], [Y2020 + 5, 'A', 'B', 7, 'not-an-mbid']] };
    expect(parseHistoryFile(JSON.stringify(dirty))!.scrobbles).toEqual([...rows, [Y2020 + 5, 'A', 'B', null, null]]);
  });

  it('rejects anything that is not a Quiztape history file', () => {
    expect(parseHistoryFile('not json')).toBeNull();
    expect(parseHistoryFile('[]')).toBeNull();
    expect(parseHistoryFile(JSON.stringify({ format: 'something-else', version: 1, username: 'x', scrobbles: [] }))).toBeNull();
  });
});

describe('nameKey', () => {
  it('trims, collapses whitespace and lower-cases', () => {
    expect(nameKey('  Boards   of Canada ')).toBe('boards of canada');
  });
});
