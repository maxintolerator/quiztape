import { mbIngestJob } from './mb-ingest';
import type { JobHandlers } from './runner';

/** Registry of job kinds the runner knows how to execute. Wikidata enrichment lands with the optional toggles. */
export const handlers: JobHandlers = {
  mb_ingest: mbIngestJob,
};
