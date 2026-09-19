import { backfillJob, incrementalJob } from './backfill';
import { mbIngestJob } from './mb-ingest';
import type { JobHandlers } from './runner';
import { statsRebuildJob } from './stats';

/** Registry of job kinds the runner knows how to execute. Wikidata enrichment lands with the optional toggles. */
export const handlers: JobHandlers = {
  backfill: backfillJob,
  incremental: incrementalJob,
  stats_rebuild: statsRebuildJob,
  mb_ingest: mbIngestJob,
};
