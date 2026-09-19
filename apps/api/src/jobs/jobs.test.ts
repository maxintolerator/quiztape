import { schema } from '@quiztape/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFakeLastfm, track } from '../fake-lastfm';
import { ensureUserRows, syncSummary } from '../lib/users';
import type { Services } from '../services';
import { createTestServices } from '../testing';
import { handlers } from './handlers';
import { enqueueJob } from './queue';
import { JobRunner } from './runner';

const T0 = 1_600_000_000;
const history = [
  track(T0 + 0, 'Boards of Canada', 'Roygbiv', 'Music Has the Right to Children'),
  track(T0 + 300, 'Boards of Canada', 'Aquarius', 'Music Has the Right to Children'),
  track(T0 + 600, 'Boards of Canada', 'Roygbiv', 'Music Has the Right to Children'),
  track(T0 + 900, 'Radiohead', 'Airbag', 'OK Computer'),
  track(T0 + 1200, 'Radiohead', 'Airbag', 'OK Computer'),
  track(T0 + 1500, 'Radiohead', 'Airbag', 'OK Computer'),
  track(T0 + 1800, 'Radiohead', 'Lucky', 'OK Computer'),
  track(T0 + 31_536_000 + 100, 'Autechre', 'Bike', 'Incunabula'),
];

let services: Services;
let clock = Date.now();
const { date: _ignored, ...nowPlayingBase } = track(0, 'Now', 'Playing');
const fake = createFakeLastfm({
  history,
  perPage: 3,
  nowPlaying: { ...nowPlayingBase, '@attr': { nowplaying: 'true' } },
});
let userId: string;

beforeAll(async () => {
  services = await createTestServices({ fetch: fake.fetch, now: () => new Date(clock) });
  const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'someone', lastfmUsernameKey: 'someone' }).returning();
  userId = user!.id;
  await ensureUserRows(services, userId);
}, 120_000);

afterAll(async () => {
  await services?.close();
});

describe('backfill and rollups', () => {
  it('imports the whole history page by page, skips now-playing, dedupes, then rebuilds stats', async () => {
    await enqueueJob(services, { kind: 'backfill', userId, dedupeKey: `backfill:${userId}` });
    // Queueing the same work twice is a no-op while it is pending.
    expect(await enqueueJob(services, { kind: 'backfill', userId, dedupeKey: `backfill:${userId}` })).toBeNull();

    const runner = new JobRunner(services, handlers, { workerId: 'test', retryBaseMs: 1 });
    const ran = await runner.drain();
    expect(ran).toBe(3); // backfill, the stats_rebuild it queued, then the mb_ingest the rebuild queued

    const recentTrackCalls = fake.state.calls.filter((u) => u.searchParams.get('method') === 'user.getRecentTracks');
    expect(recentTrackCalls).toHaveLength(3); // 8 tracks / 3 per page
    expect(recentTrackCalls[0]!.searchParams.get('to')).toBe(String(Math.floor(clock / 1000)));
    expect(recentTrackCalls[0]!.searchParams.get('extended')).toBe('1');

    const scrobbles = await services.db.select().from(schema.scrobbles).where(eq(schema.scrobbles.userId, userId));
    expect(scrobbles).toHaveLength(8);
    expect(scrobbles.every((s) => s.artistKey === s.artistName.toLowerCase())).toBe(true);

    const summary = await syncSummary(services, userId);
    expect(summary.phase).toBe('complete');
    expect(summary.scrobbleCount).toBe(8);
    expect(summary.percent).toBe(100);
    expect(summary.statsBuiltAt).not.toBeNull();

    const artists = await services.db
      .select()
      .from(schema.userArtistStats)
      .where(eq(schema.userArtistStats.userId, userId))
      .orderBy(schema.userArtistStats.rank);
    expect(artists.map((a) => [a.artistName, a.playCount, a.rank, a.difficulty])).toEqual([
      ['Radiohead', 4, 1, 'deep_cut'],
      ['Boards of Canada', 3, 2, 'deep_cut'],
      ['Autechre', 1, 3, 'deep_cut'],
    ]);

    const [airbag] = await services.db
      .select()
      .from(schema.userTrackStats)
      .where(and(eq(schema.userTrackStats.userId, userId), eq(schema.userTrackStats.trackKey, 'airbag')));
    expect(airbag).toMatchObject({ playCount: 3, rankOverall: 1, rankInArtist: 1 });

    const years = await services.db.select().from(schema.userYearArtistStats).where(eq(schema.userYearArtistStats.userId, userId));
    expect(new Set(years.map((y) => y.year))).toEqual(new Set([2020, 2021]));
    expect(years.find((y) => y.year === 2021)).toMatchObject({ artistKey: 'autechre', rankInYear: 1 });
  });

  it('incremental sync fetches only what is newer and re-ranks', async () => {
    clock += 60 * 60 * 1000;
    fake.state.history.unshift(
      track(T0 + 31_536_000 + 200, 'Autechre', 'Bike', 'Incunabula'),
      track(T0 + 31_536_000 + 300, 'Autechre', 'Bike', 'Incunabula'),
      track(T0 + 31_536_000 + 400, 'Autechre', 'Bike', 'Incunabula'),
      track(T0 + 31_536_000 + 500, 'Autechre', 'Bike', 'Incunabula'),
    );
    const before = fake.state.calls.length;
    await enqueueJob(services, { kind: 'incremental', userId, dedupeKey: `incremental:${userId}` });
    const runner = new JobRunner(services, handlers, { workerId: 'test', retryBaseMs: 1 });
    await runner.drain();
    const calls = fake.state.calls.slice(before).filter((u) => u.searchParams.get('method') === 'user.getRecentTracks');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.searchParams.get('from')).toBe(String(T0 + 31_536_000 + 100));

    const summary = await syncSummary(services, userId);
    expect(summary.scrobbleCount).toBe(12);
    const [top] = await services.db.select().from(schema.userArtistStats).where(and(eq(schema.userArtistStats.userId, userId), eq(schema.userArtistStats.rank, 1)));
    expect(top?.artistName).toBe('Autechre');
  });

  it('retries a failing job with back-off and resumes the backfill from its checkpoint', async () => {
    const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'flaky', lastfmUsernameKey: 'flaky' }).returning();
    await ensureUserRows(services, user!.id);
    fake.state.username = 'flaky';
    fake.state.recentTracksError = 16;
    const jobId = await enqueueJob(services, { kind: 'backfill', userId: user!.id, dedupeKey: `backfill:${user!.id}` });
    const runner = new JobRunner(services, handlers, { workerId: 'test', retryBaseMs: 1_000 });
    expect(await runner.runOnce()).toBe(jobId);

    let [job] = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId!));
    expect(job).toMatchObject({ status: 'queued', attempts: 1 });
    expect(job!.lastError).toContain('16');
    expect(job!.runAfter.getTime()).toBeGreaterThan(clock);
    expect(await runner.runOnce()).toBeNull(); // not yet due

    clock = job!.runAfter.getTime() + 1;
    fake.state.recentTracksError = null;
    expect(await runner.runOnce()).toBe(jobId);
    [job] = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId!));
    expect(job).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect((await syncSummary(services, user!.id)).phase).toBe('complete');
  });

  it('marks privacy-blocked users instead of failing the job', async () => {
    const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'private', lastfmUsernameKey: 'private' }).returning();
    await ensureUserRows(services, user!.id);
    fake.state.username = 'private';
    fake.state.recentTracksError = 17;
    await enqueueJob(services, { kind: 'backfill', userId: user!.id, dedupeKey: `backfill:${user!.id}` });
    const runner = new JobRunner(services, handlers, { workerId: 'test' });
    await runner.drain();
    const summary = await syncSummary(services, user!.id);
    expect(summary.phase).toBe('privacy_blocked');
    fake.state.recentTracksError = null;
  });
});
