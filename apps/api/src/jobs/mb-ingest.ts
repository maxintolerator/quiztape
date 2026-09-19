import { schema } from '@quiztape/db';
import { HttpError } from '@quiztape/ratelimit';
import { MIN_PLAYS_FOR_QUESTIONS } from '@quiztape/shared';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { ingestArtist, ingestDiscography, ingestMembers, ingestTracklists, resolveArtist } from '../ingest/musicbrainz';
import type { JobHandler } from './runner';

/**
 * Bring MusicBrainz facts in for every artist the user could be asked about,
 * most played first. Each step is idempotent and cache-aware, so a retried or
 * resumed job skips what is already fresh. Transport failures propagate so the
 * runner backs off; data problems for one artist are recorded and skipped.
 */
export const mbIngestJob: JobHandler = async ({ services, job, heartbeat, signal }) => {
  const { db } = services;
  if (!job.userId) throw new Error('mb_ingest job without userId');
  const eligible = await db
    .select({ artistKey: schema.userArtistStats.artistKey, artistName: schema.userArtistStats.artistName, rank: schema.userArtistStats.rank })
    .from(schema.userArtistStats)
    .where(and(eq(schema.userArtistStats.userId, job.userId), gte(schema.userArtistStats.playCount, MIN_PLAYS_FOR_QUESTIONS)))
    .orderBy(schema.userArtistStats.rank);

  const progress = { artistsTotal: eligible.length, artistsDone: 0, resolved: 0, notFound: 0, failed: 0, current: '' };
  await heartbeat(progress);

  for (const artist of eligible) {
    if (signal.aborted) throw new Error('aborted');
    progress.current = artist.artistName;
    try {
      const hint = await topHint(services.db, job.userId, artist.artistKey);
      const mbid = await resolveArtist(services, { artistKey: artist.artistKey, displayName: artist.artistName, lastfmMbidHint: hint });
      if (!mbid) {
        progress.notFound++;
      } else {
        progress.resolved++;
        const row = await ingestArtist(services, mbid);
        if (row && !row.isSpecialPurpose) {
          if (row.type === 'Group' || row.type === 'Orchestra') await ingestMembers(services, row, signal);
          await ingestDiscography(services, row, signal);
          await ingestTracklists(services, row.mbid, signal);
        }
      }
    } catch (error) {
      if (error instanceof HttpError || error instanceof TypeError || (error instanceof Error && error.message === 'aborted')) throw error;
      progress.failed++;
      console.error(`mb_ingest: ${artist.artistName}: ${error instanceof Error ? error.message : String(error)}`);
    }
    progress.artistsDone++;
    await heartbeat(progress);
  }
};

/** The MBID Last.fm attached most often to this artist's plays; a hint, never trusted blindly. */
async function topHint(db: Parameters<JobHandler>[0]['services']['db'], userId: string, artistKey: string): Promise<string | null> {
  const [row] = await db
    .select({ hint: schema.scrobbles.artistMbidHint, n: sql<number>`count(*)::int` })
    .from(schema.scrobbles)
    .where(and(eq(schema.scrobbles.userId, userId), eq(schema.scrobbles.artistKey, artistKey), isNotNull(schema.scrobbles.artistMbidHint)))
    .groupBy(schema.scrobbles.artistMbidHint)
    .orderBy(desc(sql`count(*)`))
    .limit(1);
  return row?.hint ?? null;
}
