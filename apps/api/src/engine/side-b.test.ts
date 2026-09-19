import { schema } from '@quiztape/db';
import type { RecentTrack } from '@quiztape/lastfm';
import { ARTIST_RELATION_TYPE_ID } from '@quiztape/musicbrainz';
import type { AnswerResultDto, RoundStateDto, SyncSummary } from '@quiztape/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { createFakeLastfm, track } from '../fake-lastfm';
import { createFakeMusicBrainz, idFor } from '../fake-musicbrainz';
import { handlers } from '../jobs/handlers';
import { enqueueJob } from '../jobs/queue';
import { JobRunner } from '../jobs/runner';
import { sha256Hex } from '../lib/crypto';
import { ensureUserRows, syncSummary } from '../lib/users';
import type { Services } from '../services';
import { createTestServices } from '../testing';

const GROUPS = ['Radiohead', 'Boards of Canada', 'Autechre', 'Portishead', 'Massive Attack', 'Burial', 'Four Tet', 'Caribou', 'Bonobo'];

const mb = createFakeMusicBrainz([
  {
    name: 'Radiohead',
    type: 'Group',
    country: 'GB',
    albums: { 'Pablo Honey': '1993-02-22', 'The Bends': '1995-03-13', 'OK Computer': '1997-05-21', 'Kid A': '2000-10-02' },
    compilations: ['Radiohead: The Best Of'],
    members: [
      { name: 'Thom Yorke', instruments: ['lead vocals', 'guitar'], original: true, begin: '1985' },
      { name: 'Jonny Greenwood', instruments: ['guitar'], original: true, begin: '1985' },
      { name: 'Phil Selway', instruments: ['drums'], original: true, begin: '1985' },
      { name: 'Guest Drummer', instruments: ['drums'], begin: '2001', end: '2004' },
    ],
  },
  { name: 'The Smile', type: 'Group', country: 'GB', albums: { 'A Light for Attracting Attention': '2022-05-13' }, members: [{ name: 'Thom Yorke', begin: '2021' }, { name: 'Jonny Greenwood', begin: '2021' }] },
  ...GROUPS.slice(1).map((name, i) => ({
    name,
    type: 'Group' as const,
    country: 'GB',
    albums: { [`${name} One`]: `${1994 + i}-01-10`, [`${name} Two`]: `${1998 + i}-06-15`, [`${name} Three`]: `${2003 + i}-09-01` },
    members: [{ name: `${name} Founder`, original: true, begin: '1990' }],
  })),
]);

function buildHistory() {
  const rows: RecentTrack[] = [];
  let t = 1_500_000_000;
  GROUPS.forEach((artist, i) => {
    const plays = 120 - i * 7;
    for (let p = 0; p < plays; p++) {
      const albumNo = (p % 3) + 1;
      const song = (p % 5) + 1;
      t += 700 + ((i * 31 + p * 17) % 400);
      const album = artist === 'Radiohead' ? ['Pablo Honey', 'The Bends', 'OK Computer'][albumNo - 1]! : `${artist} ${['One', 'Two', 'Three'][albumNo - 1]}`;
      rows.push(track(t, artist, `${album} Song ${song}`, album));
    }
  });
  return rows;
}

let services: Services;
let app: ReturnType<typeof createApp>;
let token: string;
let userId: string;

beforeAll(async () => {
  const lastfm = createFakeLastfm({ history: buildHistory(), perPage: 200 });
  const fetch = (url: string, init?: RequestInit) => (url.includes('musicbrainz.org') ? mb.fetch(url) : lastfm.fetch(url, init));
  services = await createTestServices({ fetch });
  app = createApp(services);
  const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'someone', lastfmUsernameKey: 'someone' }).returning();
  userId = user!.id;
  await ensureUserRows(services, userId);
  token = 'test-token-' + 'y'.repeat(30);
  await services.db.insert(schema.appSessions).values({ userId, tokenHash: sha256Hex(token), platform: 'web', expiresAt: new Date(Date.now() + 86_400_000) });
  await enqueueJob(services, { kind: 'backfill', userId, dedupeKey: `backfill:${userId}` });
  await new JobRunner(services, handlers, { workerId: 'test' }).drain(); // backfill -> stats_rebuild -> mb_ingest
}, 240_000);

afterAll(async () => {
  await services?.close();
});

const authed = (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } });

describe('MusicBrainz ingestion', () => {
  it('resolves eligible artists, caches discographies and reports trivia readiness', async () => {
    const summary: SyncSummary = await syncSummary(services, userId);
    expect(summary.trivia.eligibleArtists).toBe(9);
    expect(summary.trivia.resolvedArtists).toBe(9);
    expect(summary.trivia.readyArtists).toBe(9);
    expect(summary.trivia.ready).toBe(true);
    expect(summary.trivia.running).toBe(false);
  });

  it('keeps only sole-credit studio albums with an official release and picks the plain CD as canonical', async () => {
    const radiohead = idFor('artist:Radiohead');
    const groups = await services.db.select().from(schema.mbReleaseGroups).where(eq(schema.mbReleaseGroups.primaryArtistMbid, radiohead)).orderBy(schema.mbReleaseGroups.firstReleaseDate);
    expect(groups.filter((g) => g.isStudioAlbum).map((g) => g.title)).toEqual(['Pablo Honey', 'The Bends', 'OK Computer', 'Kid A']);
    expect(groups.some((g) => g.title.includes('Best Of'))).toBe(false);
    const ok = groups.find((g) => g.title === 'OK Computer')!;
    expect(ok.firstReleaseYear).toBe(1997);
    const [canonical] = await services.db.select().from(schema.mbReleases).where(and(eq(schema.mbReleases.releaseGroupMbid, ok.mbid), eq(schema.mbReleases.isCanonical, true)));
    expect(canonical?.mbid).toBe(idFor('rel:Radiohead:OK Computer:cd'));
    expect(canonical?.title).toBe('OK Computer');
    const tracks = await services.db.select().from(schema.mbTracks).where(eq(schema.mbTracks.releaseMbid, canonical!.mbid)).orderBy(schema.mbTracks.absolutePosition);
    expect(tracks).toHaveLength(5);
    expect(tracks[0]).toMatchObject({ isOpener: true, isCloser: false, position: 1 });
    expect(tracks[4]).toMatchObject({ isOpener: false, isCloser: true, position: 5, lengthMs: 180_000 + 4 * 37_000 });
  });

  it('stores memberships in canonical orientation with instruments merged into one stint, and members\' other bands', async () => {
    const radiohead = idFor('artist:Radiohead');
    const rows = await services.db.select().from(schema.mbArtistRelations).where(and(eq(schema.mbArtistRelations.entity1Mbid, radiohead), eq(schema.mbArtistRelations.typeId, ARTIST_RELATION_TYPE_ID.MEMBER_OF_BAND)));
    const thom = rows.filter((r) => r.entity0Name === 'Thom Yorke');
    expect(thom).toHaveLength(1);
    expect(thom[0]!.attributes).toEqual(['guitar', 'lead vocals', 'original']);
    expect(thom[0]!.isOriginal).toBe(true);
    const guest = rows.find((r) => r.entity0Name === 'Guest Drummer')!;
    expect(guest).toMatchObject({ ended: true, beginYear: 2001, endYear: 2004 });
    // Thom's own lookup brought The Smile in.
    const smile = await services.db.select().from(schema.mbArtistRelations).where(and(eq(schema.mbArtistRelations.entity0Mbid, idFor('artist:Thom Yorke')), eq(schema.mbArtistRelations.entity1Mbid, idFor('artist:The Smile'))));
    expect(smile).toHaveLength(1);
  });

  it('never re-fetches what is cached: a second ingestion makes no MusicBrainz requests', async () => {
    const before = mb.calls.length;
    await enqueueJob(services, { kind: 'mb_ingest', userId, dedupeKey: `mb_ingest:${userId}` });
    await new JobRunner(services, handlers, { workerId: 'test' }).drain();
    expect(mb.calls.length).toBe(before);
  });
});

describe('Side B and Mixtape rounds', () => {
  it('cuts a Side B round from the cache and grades order and duration answers', async () => {
    const created = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'side_b', difficulty: 'easy', length: 10 }) }));
    expect(created.status).toBe(201);
    const state = (await created.json()) as RoundStateDto;
    expect(state.round.questionCount).toBeGreaterThanOrEqual(6);
    let question = state.question!;
    const categories = new Set<string>();
    let correct = 0;
    for (let i = 0; i < state.round.questionCount; i++) {
      categories.add(question.category);
      expect(question.side).toBe('b');
      const [row] = await services.db.select().from(schema.roundQuestions).where(eq(schema.roundQuestions.id, question.id));
      const submission =
        row!.answerFormat === 'order'
          ? { kind: 'order', optionIds: (row!.correctAnswer as { order: string[] }).order }
          : row!.answerFormat === 'multiple_choice'
            ? { kind: 'option', optionId: (row!.correctAnswer as { optionId: string }).optionId }
            : { kind: 'numeric', value: Number(row!.numericAnswer) + (question.unit === 'duration' ? 10 : 0) };
      const res = await app.request(`/v1/rounds/${state.round.id}/answers`, authed({ method: 'POST', body: JSON.stringify({ questionId: question.id, submission, responseMs: 3_000 }) }));
      expect(res.status).toBe(200);
      const result = (await res.json()) as AnswerResultDto;
      if (result.correct) correct++;
      if (result.nextQuestion) question = result.nextQuestion;
    }
    expect(correct).toBe(state.round.questionCount);
    expect(categories.size).toBeGreaterThanOrEqual(4);
    expect([...categories].every((c) => !['stats_artist_rank', 'stats_head_to_head'].includes(c))).toBe(true);
  });

  it('mixes both sides in a mixtape', async () => {
    const created = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'mixtape', difficulty: 'medium', length: 10 }) }));
    expect(created.status).toBe(201);
    const { round } = (await created.json()) as RoundStateDto;
    const rows = await services.db.select({ category: schema.roundQuestions.category }).from(schema.roundQuestions).where(eq(schema.roundQuestions.roundId, round.id));
    const sides = new Set(rows.map((r) => (r.category.startsWith('stats_') ? 'a' : 'b')));
    expect(sides).toEqual(new Set(['a', 'b']));
  });

  it('still refuses bracket', async () => {
    const res = await app.request('/v1/rounds', authed({ method: 'POST', body: JSON.stringify({ mode: 'bracket', difficulty: 'easy', length: 5 }) }));
    expect(res.status).toBe(400);
  });
});
