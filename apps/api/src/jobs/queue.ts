import { schema } from '@quiztape/db';
import { and, eq, inArray } from 'drizzle-orm';

import type { Services } from '../services';

export type JobKind = (typeof schema.syncJobKind.enumValues)[number];

export interface EnqueueOptions {
  kind: JobKind;
  dedupeKey: string;
  userId?: string | undefined;
  mbid?: string | undefined;
  priority?: number | undefined;
  payload?: Record<string, unknown> | undefined;
  runAfter?: Date | undefined;
}

/** Queue a job unless an identical one is already queued or running. Returns the job id, or null when deduplicated. */
export async function enqueueJob(services: Services, options: EnqueueOptions): Promise<number | null> {
  const { db, now } = services;
  const existing = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.dedupeKey, options.dedupeKey), inArray(schema.syncJobs.status, ['queued', 'running'])))
    .limit(1);
  if (existing.length > 0) return null;
  const [row] = await db
    .insert(schema.syncJobs)
    .values({
      kind: options.kind,
      dedupeKey: options.dedupeKey,
      userId: options.userId ?? null,
      mbid: options.mbid ?? null,
      priority: options.priority ?? 0,
      payload: options.payload ?? {},
      runAfter: options.runAfter ?? now(),
    })
    .returning({ id: schema.syncJobs.id });
  return row?.id ?? null;
}
