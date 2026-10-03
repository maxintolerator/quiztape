import { schema } from '@quiztape/db';
import { HttpError } from '@quiztape/ratelimit';
import { type LibraryArtistRef, TRIVIA_ARTIST_CAP, nameKey } from '@quiztape/shared';
import { eq } from 'drizzle-orm';

import { ingestArtist, ingestDiscography, ingestMembers, ingestTracklists, resolveArtist } from '../ingest/musicbrainz';
import type { Services } from '../services';
import { enqueueJob } from './queue';
import type { JobHandler } from './runner';

/** Members' side projects are fetched only for artists the user plays a lot; deep cuts get discographies only. */
const MEMBERS_MAX_RANK = 150;
/** Fresh enough to skip. */
const FRESH_DAYS = 30;

interface ArtistTask {
  task: 'artist';
  artistKey: string;
  displayName: string;
  lastfmMbidHint: string | null;
  rank: number;
}

/**
 * Two shapes share the `mb_ingest` kind:
 *  - user job (payload.artists): the player's most played artists, as announced
 *    by their device; queues one artist job each. Finishes in seconds.
 *  - artist job (payload.task = 'artist'): resolves and ingests one artist.
 *    Deduplicated by artist key across users, prioritised by rank, so several
 *    machines (one MusicBrainz request per second each) and several users
 *    share the queue without one big library starving the others.
 */
export const mbIngestJob: JobHandler = async (ctx) => {
  const payload = ctx.job.payload as Partial<ArtistTask>;
  if (payload.task === 'artist') return ingestOneArtist(ctx, payload as ArtistTask);
  return fanOutUser(ctx);
};

const fanOutUser: JobHandler = async ({ services, job, heartbeat }) => {
  if (!job.userId) throw new Error('mb_ingest job without userId');
  const announced = ((job.payload as { artists?: LibraryArtistRef[] }).artists ?? []).slice(0, TRIVIA_ARTIST_CAP);

  let queued = 0;
  let skipped = 0;
  for (const artist of announced) {
    // The key is always derived here: the cache is shared, a client-chosen key could point one artist's name at another's facts.
    const artistKey = nameKey(artist.name);
    if (!artistKey || (await isFresh(services, artistKey))) {
      skipped++;
      continue;
    }
    const task: ArtistTask = { task: 'artist', artistKey, displayName: artist.name, lastfmMbidHint: artist.mbidHint, rank: artist.rank };
    const id = await enqueueJob(services, {
      kind: 'mb_ingest',
      dedupeKey: `mb_artist:${artistKey}`,
      userId: job.userId,
      priority: Math.max(0, 1000 - artist.rank),
      payload: { ...task },
    });
    if (id !== null) queued++;
  }
  await heartbeat({ artistsTotal: announced.length, queued, skipped });
};

async function ingestOneArtist(ctx: Parameters<JobHandler>[0], task: ArtistTask): Promise<void> {
  const { services, signal, heartbeat } = ctx;
  try {
    const mbid = await resolveArtist(services, { artistKey: task.artistKey, displayName: task.displayName, lastfmMbidHint: task.lastfmMbidHint });
    if (!mbid) {
      await heartbeat({ artist: task.displayName, outcome: 'not_found' });
      return;
    }
    const row = await ingestArtist(services, mbid);
    if (!row || row.isSpecialPurpose) return;
    if ((row.type === 'Group' || row.type === 'Orchestra') && task.rank <= MEMBERS_MAX_RANK) await ingestMembers(services, row, signal);
    await heartbeat({ artist: task.displayName, stage: 'discography' });
    await ingestDiscography(services, row, signal);
    await heartbeat({ artist: task.displayName, stage: 'tracklists' });
    await ingestTracklists(services, row.mbid, signal);
    await heartbeat({ artist: task.displayName, outcome: 'ready' });
  } catch (error) {
    // Transport trouble is the runner's business (back-off and retry); a data problem for one artist is not.
    if (error instanceof HttpError || error instanceof TypeError || (error instanceof Error && error.message === 'aborted')) throw error;
    console.error(`mb_ingest: ${task.displayName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Already resolved and ingested recently, or resolved as unusable with a retry date still in the future. */
async function isFresh(services: Services, artistKey: string): Promise<boolean> {
  const { db, now } = services;
  const [resolution] = await db.select().from(schema.artistResolutions).where(eq(schema.artistResolutions.artistKey, artistKey)).limit(1);
  if (!resolution) return false;
  if (resolution.status === 'special_purpose') return true;
  if (resolution.status !== 'resolved' || !resolution.mbid) return !!resolution.nextAttemptAt && resolution.nextAttemptAt.getTime() > now().getTime();
  const [artist] = await db.select({ tracklistsFetchedAt: schema.mbArtists.tracklistsFetchedAt }).from(schema.mbArtists).where(eq(schema.mbArtists.mbid, resolution.mbid)).limit(1);
  return !!artist?.tracklistsFetchedAt && artist.tracklistsFetchedAt.getTime() > now().getTime() - FRESH_DAYS * 86_400_000;
}
