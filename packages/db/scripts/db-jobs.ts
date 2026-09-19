/**
 * Support view: users, their sync state, and recent jobs with errors.
 * Run: npm run db:jobs
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const dotenv = resolve(here, '..', '..', '..', '.env');
if (existsSync(dotenv)) process.loadEnvFile(dotenv);
const url = process.env['DATABASE_MIGRATE_URL'] || process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });
try {
  const users = await sql`select u.lastfm_username, u.created_at, s.phase, s.backfill_next_page, s.backfill_total_pages, s.scrobble_count, s.stats_built_at, s.last_error_code, s.last_error
    from users u left join user_sync_state s on s.user_id = u.id order by u.created_at desc limit 20`;
  console.log('users / sync state:');
  for (const u of users) console.log(' ', JSON.stringify(u));
  const jobs = await sql`select id, kind, status, priority, attempts, max_attempts, run_after, locked_by, lease_expires_at, started_at, finished_at, left(last_error, 300) as last_error, progress, created_at
    from sync_jobs order by id desc limit 20`;
  console.log(`\njobs (${jobs.length}):`);
  for (const j of jobs) console.log(' ', JSON.stringify(j));
  const counts = await sql`select (select count(*)::int from scrobbles) as scrobbles, (select count(*)::int from app_sessions) as sessions, (select count(*)::int from auth_flows) as flows`;
  console.log('\ncounts:', JSON.stringify(counts[0]));
} finally {
  await sql.end({ timeout: 5 });
}
