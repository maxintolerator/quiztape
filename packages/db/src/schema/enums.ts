import { DIFFICULTIES, GRADING_METHODS, QUESTION_CATEGORIES, QUIZ_MODES } from '@quiztape/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

// ---- auth / sync
export const clientPlatform = pgEnum('client_platform', ['web', 'ios', 'android']);
export const lastfmSessionStatus = pgEnum('lastfm_session_status', ['active', 'revoked']);
export const syncPhase = pgEnum('sync_phase', ['pending', 'backfilling', 'complete', 'privacy_blocked', 'error']);
export const syncJobKind = pgEnum('sync_job_kind', ['backfill', 'incremental', 'stats_rebuild', 'top_charts', 'mb_ingest', 'wd_enrich']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);

// ---- name -> MBID resolution
export const resolutionStatus = pgEnum('resolution_status', ['pending', 'resolved', 'ambiguous', 'not_found', 'special_purpose']);
export const resolutionMethod = pgEnum('resolution_method', ['lastfm_hint', 'search_exact', 'search_fuzzy', 'manual']);

// ---- MusicBrainz cache
export const mbEntityType = pgEnum('mb_entity_type', ['artist', 'release_group', 'release', 'recording', 'label', 'work']);
export const mbFetchStatus = pgEnum('mb_fetch_status', ['pending', 'ok', 'not_found', 'error']);
export const mbArtistType = pgEnum('mb_artist_type', ['Person', 'Group', 'Orchestra', 'Choir', 'Character', 'Other']);
export const rgPrimaryType = pgEnum('rg_primary_type', ['Album', 'Single', 'EP', 'Broadcast', 'Other']);
export const releaseStatus = pgEnum('release_status', ['Official', 'Promotion', 'Bootleg', 'Pseudo-Release', 'Withdrawn', 'Cancelled', 'Expunged']);

// ---- Wikidata
export const wdResolution = pgEnum('wd_resolution', ['pending', 'mb_url_rel', 'unique', 'ambiguous', 'none']);

// ---- quiz (vocabulary shared with the client through @quiztape/shared)
export const quizMode = pgEnum('quiz_mode', QUIZ_MODES);
export const difficulty = pgEnum('difficulty', DIFFICULTIES);
export const questionCategory = pgEnum('question_category', QUESTION_CATEGORIES);
export const gradingMethod = pgEnum('grading_method', GRADING_METHODS);
export const answerFormat = pgEnum('answer_format', ['multiple_choice', 'free_text', 'numeric', 'order']);
export const roundStatus = pgEnum('round_status', ['draft', 'active', 'completed', 'abandoned']);
export const bracketStatus = pgEnum('bracket_status', ['active', 'completed', 'abandoned']);
export const llmPurpose = pgEnum('llm_purpose', ['rephrase', 'grade']);
