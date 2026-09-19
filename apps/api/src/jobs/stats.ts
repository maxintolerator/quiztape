import { schema } from '@quiztape/db';
import { DIFFICULTY_RULE } from '@quiztape/shared';
import { eq, sql } from 'drizzle-orm';

import type { Services } from '../services';
import type { JobHandler } from './runner';

/**
 * Rebuild every per-user rollup from the scrobble table in one transaction.
 * Difficulty thresholds come from @quiztape/shared so the rule has one home.
 */
export async function rebuildUserStats(services: Services, userId: string): Promise<void> {
  const { db, now } = services;
  const [settings] = await db.select({ timezone: schema.userSettings.timezone }).from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).limit(1);
  const timezone = settings?.timezone ?? 'UTC';
  const { easyMaxRank, mediumMaxRank, hardMaxRank, deepCutMaxPlays } = DIFFICULTY_RULE;

  await db.transaction(async (tx) => {
    await tx.delete(schema.userArtistStats).where(eq(schema.userArtistStats.userId, userId));
    await tx.execute(sql`
      with agg as (
        select user_id, artist_key,
               (array_agg(artist_name order by played_at desc))[1] as artist_name,
               count(*)::int as play_count,
               min(played_at) as first_played_at,
               max(played_at) as last_played_at,
               count(distinct track_key)::int as distinct_tracks,
               count(distinct album_key)::int as distinct_albums
        from scrobbles where user_id = ${userId}
        group by user_id, artist_key
      ), ranked as (
        select *, row_number() over (order by play_count desc, first_played_at asc, artist_key asc)::int as rank from agg
      )
      insert into user_artist_stats (user_id, artist_key, artist_name, play_count, rank, difficulty, first_played_at, last_played_at, distinct_tracks, distinct_albums, computed_at)
      select user_id, artist_key, artist_name, play_count, rank,
             case
               when play_count <= ${deepCutMaxPlays} then 'deep_cut'
               when rank <= ${easyMaxRank} then 'easy'
               when rank <= ${mediumMaxRank} then 'medium'
               when rank <= ${hardMaxRank} then 'hard'
               else 'deep_cut'
             end::difficulty,
             first_played_at, last_played_at, distinct_tracks, distinct_albums, now()
      from ranked
    `);

    await tx.delete(schema.userTrackStats).where(eq(schema.userTrackStats.userId, userId));
    await tx.execute(sql`
      with agg as (
        select user_id, artist_key, track_key,
               (array_agg(track_name order by played_at desc))[1] as track_name,
               count(*)::int as play_count,
               min(played_at) as first_played_at,
               max(played_at) as last_played_at
        from scrobbles where user_id = ${userId}
        group by user_id, artist_key, track_key
      )
      insert into user_track_stats (user_id, artist_key, track_key, track_name, play_count, rank_overall, rank_in_artist, first_played_at, last_played_at, computed_at)
      select user_id, artist_key, track_key, track_name, play_count,
             row_number() over (order by play_count desc, first_played_at asc, artist_key, track_key)::int,
             row_number() over (partition by artist_key order by play_count desc, first_played_at asc, track_key)::int,
             first_played_at, last_played_at, now()
      from agg
    `);

    await tx.delete(schema.userAlbumStats).where(eq(schema.userAlbumStats.userId, userId));
    await tx.execute(sql`
      with agg as (
        select user_id, artist_key, album_key,
               (array_agg(album_name order by played_at desc))[1] as album_name,
               count(*)::int as play_count,
               min(played_at) as first_played_at
        from scrobbles where user_id = ${userId} and album_key is not null
        group by user_id, artist_key, album_key
      )
      insert into user_album_stats (user_id, artist_key, album_key, album_name, play_count, rank_overall, rank_in_artist, first_played_at, computed_at)
      select user_id, artist_key, album_key, album_name, play_count,
             row_number() over (order by play_count desc, first_played_at asc, artist_key, album_key)::int,
             row_number() over (partition by artist_key order by play_count desc, first_played_at asc, album_key)::int,
             first_played_at, now()
      from agg
    `);

    await tx.delete(schema.userYearArtistStats).where(eq(schema.userYearArtistStats.userId, userId));
    await tx.execute(sql`
      with agg as (
        select user_id, extract(year from played_at at time zone ${timezone})::smallint as year, artist_key,
               count(*)::int as play_count, min(played_at) as first_played_at
        from scrobbles where user_id = ${userId}
        group by user_id, year, artist_key
      )
      insert into user_year_artist_stats (user_id, year, artist_key, play_count, rank_in_year, computed_at)
      select user_id, year, artist_key, play_count,
             row_number() over (partition by year order by play_count desc, first_played_at asc, artist_key)::int,
             now()
      from agg
    `);

    const current = now();
    await tx
      .update(schema.userSyncState)
      .set({ statsBuiltAt: current, statsBuiltThrough: sql`coalesce(${schema.userSyncState.newestPlayedAt}, ${current})`, updatedAt: current })
      .where(eq(schema.userSyncState.userId, userId));
  });
}

export const statsRebuildJob: JobHandler = async ({ services, job }) => {
  if (!job.userId) throw new Error('stats_rebuild job without userId');
  await rebuildUserStats(services, job.userId);
};
