import { backfillJob, incrementalJob } from './backfill';
import type { JobHandlers } from './runner';
import { statsRebuildJob } from './stats';

/** Registry of job kinds the runner knows how to execute. MusicBrainz and Wikidata jobs land in step 4. */
export const handlers: JobHandlers = {
  backfill: backfillJob,
  incremental: incrementalJob,
  stats_rebuild: statsRebuildJob,
};
