import { schema } from '@quiztape/db';
import { TRIVIA_ARTIST_CAP, type TriviaSummary } from '@quiztape/shared';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { sha256Hex } from '../lib/crypto';
import { ensureUserRows } from '../lib/users';
import type { Services } from '../services';
import { createTestServices } from '../testing';
import { handlers } from './handlers';
import { enqueueJob } from './queue';
import { JobRunner } from './runner';

let services: Services;
let app: ReturnType<typeof createApp>;
let clock = Date.now();
let userId: string;
const token = 'test-token-' + 'j'.repeat(30);

beforeAll(async () => {
  services = await createTestServices({ now: () => new Date(clock) });
  app = createApp(services);
  const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'someone', lastfmUsernameKey: 'someone' }).returning();
  userId = user!.id;
  await ensureUserRows(services, userId);
  await services.db.insert(schema.appSessions).values({ userId, tokenHash: sha256Hex(token), platform: 'web', expiresAt: new Date(clock + 86_400_000) });
}, 120_000);

afterAll(async () => {
  await services?.close();
});

const announce = (artists: unknown) =>
  app.request('/v1/me/library', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ artists }) });

const artistJobs = () =>
  services.db
    .select()
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.kind, 'mb_ingest'), like(schema.syncJobs.dedupeKey, 'mb_artist:%')))
    .orderBy(schema.syncJobs.id);

const fanOutJobs = () => services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.dedupeKey, `mb_ingest:${userId}`));

describe('announcing a library', () => {
  it('queues one ingestion job per artist, most played first, with keys derived on the server', async () => {
    const res = await announce([
      { name: 'Radiohead', rank: 1, mbidHint: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
      { name: '  Boards   of Canada ', rank: 2, mbidHint: 'not-an-mbid' },
    ]);
    expect(res.status).toBe(200);
    await expect(res.json() as Promise<TriviaSummary>).resolves.toEqual({ eligibleArtists: 2, resolvedArtists: 0, readyArtists: 0, ready: false, running: true });

    const runner = new JobRunner(services, handlers, { workerId: 'test', retryBaseMs: 1 });
    await runner.runOnce(); // the fan-out job; the artist jobs stay queued
    const jobs = await artistJobs();
    expect(jobs.map((j) => [j.dedupeKey, j.priority, j.status])).toEqual([
      ['mb_artist:radiohead', 999, 'queued'],
      ['mb_artist:boards of canada', 998, 'queued'],
    ]);
    expect(jobs[0]!.payload).toMatchObject({ task: 'artist', artistKey: 'radiohead', displayName: 'Radiohead', lastfmMbidHint: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', rank: 1 });
    // Last.fm's MBIDs are hints of mixed quality: a malformed one is dropped, not a reason to refuse the library.
    expect(jobs[1]!.payload).toMatchObject({ artistKey: 'boards of canada', lastfmMbidHint: null });
  });

  it('ignores a repeat within ten minutes, and never queues the same artist twice', async () => {
    await announce([{ name: 'Radiohead', rank: 1, mbidHint: null }, { name: 'Autechre', rank: 2, mbidHint: null }]);
    expect(await fanOutJobs()).toHaveLength(1);

    clock += 11 * 60 * 1000;
    await announce([{ name: 'RADIOHEAD', rank: 1, mbidHint: null }, { name: 'Autechre', rank: 2, mbidHint: null }]);
    expect(await fanOutJobs()).toHaveLength(2);
    // Run only the new fan-out: artist jobs have higher priority, so park them in the future first.
    await services.db.update(schema.syncJobs).set({ runAfter: new Date(clock + 3_600_000) }).where(like(schema.syncJobs.dedupeKey, 'mb_artist:%'));
    await new JobRunner(services, handlers, { workerId: 'test', retryBaseMs: 1 }).runOnce();
    expect((await artistJobs()).map((j) => j.dedupeKey)).toEqual(['mb_artist:radiohead', 'mb_artist:boards of canada', 'mb_artist:autechre']);
  });

  it('caps the artists per announcement and validates the body', async () => {
    const tooMany = Array.from({ length: TRIVIA_ARTIST_CAP + 1 }, (_, i) => ({ name: `Artist ${i}`, rank: i + 1, mbidHint: null }));
    expect((await announce(tooMany)).status).toBe(400);
    expect((await announce([{ name: 'X', rank: 0, mbidHint: null }])).status).toBe(400);
    expect((await announce([{ name: '', rank: 1, mbidHint: null }])).status).toBe(400);
  });

  it('answers readiness for whichever artists the device names', async () => {
    const res = await app.request('/v1/me/trivia', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ artistKeys: ['never heard of them'] }),
    });
    // The user's own fan-out job has finished; nothing is pending for this artist.
    await services.db.delete(schema.syncJobs).where(eq(schema.syncJobs.userId, userId));
    const again = await app.request('/v1/me/trivia', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ artistKeys: ['never heard of them'] }),
    });
    expect(res.status).toBe(200);
    await expect(again.json()).resolves.toEqual({ eligibleArtists: 1, resolvedArtists: 0, readyArtists: 0, ready: false, running: false });
  });
});

describe('job runner', () => {
  it('retries a failing job with back-off, then succeeds', async () => {
    let failing = true;
    const runner = new JobRunner(
      services,
      {
        mb_ingest: async () => {
          if (failing) throw new Error('upstream said 503');
        },
      },
      { workerId: 'test', retryBaseMs: 1_000 },
    );
    const jobId = await enqueueJob(services, { kind: 'mb_ingest', dedupeKey: 'retry-test', priority: 5_000 });
    expect(await enqueueJob(services, { kind: 'mb_ingest', dedupeKey: 'retry-test' })).toBeNull(); // deduplicated while pending
    expect(await runner.runOnce()).toBe(jobId);

    let [job] = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId!));
    expect(job).toMatchObject({ status: 'queued', attempts: 1 });
    expect(job!.lastError).toContain('503');
    expect(job!.runAfter.getTime()).toBeGreaterThan(clock);
    expect(await runner.runOnce()).toBeNull(); // not yet due

    clock = job!.runAfter.getTime() + 1;
    failing = false;
    expect(await runner.runOnce()).toBe(jobId);
    [job] = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId!));
    expect(job).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('fails a job of a kind nobody handles any more, without taking the runner down', async () => {
    const jobId = await enqueueJob(services, { kind: 'backfill', dedupeKey: 'legacy-backfill', priority: 6_000 });
    const runner = new JobRunner(services, handlers, { workerId: 'test', retryBaseMs: 1 });
    expect(await runner.runOnce()).toBe(jobId);
    const [job] = await services.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId!));
    expect(job!.lastError).toContain('no handler registered');
  });
});
