import { sql } from 'drizzle-orm';

import type { Services } from '../services';

/**
 * Refuse to serve against a database that has not been migrated. A missing
 * table would otherwise surface as a 500 on the first request and a stream of
 * job-runner errors; this turns it into one actionable line at startup.
 */
export async function assertSchemaReady(services: Services): Promise<void> {
  try {
    const result = await services.db.execute(sql`select to_regclass('public.sync_jobs')::text as present`);
    const rows = (result as unknown as { rows?: Array<{ present: string | null }> }).rows ?? (result as unknown as Array<{ present: string | null }>);
    const present = Array.isArray(rows) ? rows[0]?.present : null;
    if (!present) {
      throw new Error('Database schema is missing: the sync_jobs table does not exist. Run `npm run db:migrate` (then `npm run db:check`) against DATABASE_URL and start the API again.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Database schema is missing')) throw error;
    throw new Error(`Could not reach the database at DATABASE_URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}
