CREATE TYPE "public"."answer_format" AS ENUM('multiple_choice', 'free_text', 'numeric', 'order');--> statement-breakpoint
CREATE TYPE "public"."bracket_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."client_platform" AS ENUM('web', 'ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard', 'deep_cut');--> statement-breakpoint
CREATE TYPE "public"."grading_method" AS ENUM('exact', 'numeric_tolerance', 'fuzzy', 'llm', 'timeout', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lastfm_session_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."llm_purpose" AS ENUM('rephrase', 'grade');--> statement-breakpoint
CREATE TYPE "public"."mb_artist_type" AS ENUM('Person', 'Group', 'Orchestra', 'Choir', 'Character', 'Other');--> statement-breakpoint
CREATE TYPE "public"."mb_entity_type" AS ENUM('artist', 'release_group', 'release', 'recording', 'label', 'work');--> statement-breakpoint
CREATE TYPE "public"."mb_fetch_status" AS ENUM('pending', 'ok', 'not_found', 'error');--> statement-breakpoint
CREATE TYPE "public"."question_category" AS ENUM('stats_artist_rank', 'stats_top_track_for_artist', 'stats_top_album', 'stats_discovery_order', 'stats_year_chart_topper', 'stats_head_to_head', 'disco_order_albums', 'disco_release_year', 'titles_album_contains_track', 'titles_album_opener', 'titles_album_closer', 'cross_shared_members', 'cross_side_project', 'cross_member_joined_left', 'duration_track_runtime', 'geo_origin', 'producer', 'label');--> statement-breakpoint
CREATE TYPE "public"."quiz_mode" AS ENUM('side_a', 'side_b', 'mixtape', 'bracket');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('Official', 'Promotion', 'Bootleg', 'Pseudo-Release', 'Withdrawn', 'Cancelled', 'Expunged');--> statement-breakpoint
CREATE TYPE "public"."resolution_method" AS ENUM('lastfm_hint', 'search_exact', 'search_fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('pending', 'resolved', 'ambiguous', 'not_found', 'special_purpose');--> statement-breakpoint
CREATE TYPE "public"."rg_primary_type" AS ENUM('Album', 'Single', 'EP', 'Broadcast', 'Other');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('draft', 'active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."sync_job_kind" AS ENUM('backfill', 'incremental', 'stats_rebuild', 'top_charts', 'mb_ingest', 'wd_enrich');--> statement-breakpoint
CREATE TYPE "public"."sync_phase" AS ENUM('pending', 'backfilling', 'complete', 'privacy_blocked', 'error');--> statement-breakpoint
CREATE TYPE "public"."wd_resolution" AS ENUM('pending', 'mb_url_rel', 'unique', 'ambiguous', 'none');--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"platform" "client_platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"platform" "client_platform" NOT NULL,
	"return_to" text NOT NULL,
	"lastfm_token_hash" text,
	"user_id" uuid,
	"lastfm_error_code" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lastfm_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_key_ciphertext" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"subscriber" boolean DEFAULT false NOT NULL,
	"status" "lastfm_session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"geo_origin_enabled" boolean DEFAULT false NOT NULL,
	"producer_enabled" boolean DEFAULT false NOT NULL,
	"label_enabled" boolean DEFAULT false NOT NULL,
	"default_mode" "quiz_mode" DEFAULT 'mixtape' NOT NULL,
	"default_difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"default_round_length" smallint DEFAULT 10 NOT NULL,
	"timer_seconds" smallint DEFAULT 20 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"llm_rephrase_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lastfm_username" text NOT NULL,
	"lastfm_username_key" text NOT NULL,
	"lastfm_url" text,
	"real_name" text,
	"country" text,
	"lastfm_registered_at" timestamp with time zone,
	"lastfm_reported_playcount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" "sync_job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"mbid" uuid,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sync_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phase" "sync_phase" DEFAULT 'pending' NOT NULL,
	"backfill_pinned_to" timestamp with time zone,
	"backfill_next_page" integer,
	"backfill_total_pages" integer,
	"backfill_started_at" timestamp with time zone,
	"backfill_completed_at" timestamp with time zone,
	"last_incremental_at" timestamp with time zone,
	"oldest_played_at" timestamp with time zone,
	"newest_played_at" timestamp with time zone,
	"scrobble_count" bigint DEFAULT 0 NOT NULL,
	"stats_built_through" timestamp with time zone,
	"stats_built_at" timestamp with time zone,
	"last_error_code" smallint,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrobbles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scrobbles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"artist_name" text NOT NULL,
	"artist_key" text NOT NULL,
	"track_name" text NOT NULL,
	"track_key" text NOT NULL,
	"album_name" text,
	"album_key" text,
	"artist_mbid_hint" uuid,
	"album_mbid_hint" uuid,
	"track_mbid_hint" uuid,
	"loved" boolean,
	"sync_job_id" bigint,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_album_stats" (
	"user_id" uuid NOT NULL,
	"artist_key" text NOT NULL,
	"album_key" text NOT NULL,
	"album_name" text NOT NULL,
	"play_count" integer NOT NULL,
	"rank_overall" integer NOT NULL,
	"rank_in_artist" integer NOT NULL,
	"first_played_at" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_album_stats_user_id_artist_key_album_key_pk" PRIMARY KEY("user_id","artist_key","album_key")
);
--> statement-breakpoint
CREATE TABLE "user_artist_stats" (
	"user_id" uuid NOT NULL,
	"artist_key" text NOT NULL,
	"artist_name" text NOT NULL,
	"play_count" integer NOT NULL,
	"rank" integer NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"first_played_at" timestamp with time zone NOT NULL,
	"last_played_at" timestamp with time zone NOT NULL,
	"distinct_tracks" integer DEFAULT 0 NOT NULL,
	"distinct_albums" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_artist_stats_user_id_artist_key_pk" PRIMARY KEY("user_id","artist_key")
);
--> statement-breakpoint
CREATE TABLE "user_track_stats" (
	"user_id" uuid NOT NULL,
	"artist_key" text NOT NULL,
	"track_key" text NOT NULL,
	"track_name" text NOT NULL,
	"play_count" integer NOT NULL,
	"rank_overall" integer NOT NULL,
	"rank_in_artist" integer NOT NULL,
	"first_played_at" timestamp with time zone NOT NULL,
	"last_played_at" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_track_stats_user_id_artist_key_track_key_pk" PRIMARY KEY("user_id","artist_key","track_key")
);
--> statement-breakpoint
CREATE TABLE "user_year_artist_stats" (
	"user_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"artist_key" text NOT NULL,
	"play_count" integer NOT NULL,
	"rank_in_year" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_year_artist_stats_user_id_year_artist_key_pk" PRIMARY KEY("user_id","year","artist_key")
);
--> statement-breakpoint
CREATE TABLE "artist_resolutions" (
	"artist_key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"mbid" uuid,
	"status" "resolution_status" DEFAULT 'pending' NOT NULL,
	"method" "resolution_method",
	"confidence" numeric(4, 3),
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lastfm_mbid_hint" uuid,
	"is_manual" boolean DEFAULT false NOT NULL,
	"manual_note" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mb_artist_relations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mb_artist_relations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity0_mbid" uuid NOT NULL,
	"entity0_name" text NOT NULL,
	"entity1_mbid" uuid NOT NULL,
	"entity1_name" text NOT NULL,
	"type_id" uuid NOT NULL,
	"type_name" text NOT NULL,
	"begin_date" text,
	"end_date" text,
	"ended" boolean DEFAULT false NOT NULL,
	"begin_year" smallint,
	"end_year" smallint,
	"attributes" text[] DEFAULT '{}'::text[] NOT NULL,
	"attribute_values" jsonb,
	"is_original" boolean DEFAULT false NOT NULL,
	"source_credit" text,
	"target_credit" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mb_artists" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_name" text,
	"name_key" text NOT NULL,
	"type" "mb_artist_type",
	"gender" text,
	"country" char(2),
	"area_name" text,
	"begin_area_name" text,
	"life_begin" text,
	"life_end" text,
	"life_ended" boolean DEFAULT false NOT NULL,
	"begin_year" smallint,
	"end_year" smallint,
	"disambiguation" text DEFAULT '' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_special_purpose" boolean DEFAULT false NOT NULL,
	"wikidata_qid" text,
	"fetch_status" "mb_fetch_status" DEFAULT 'ok' NOT NULL,
	"fetched_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"rels_fetched_at" timestamp with time zone,
	"discography_fetched_at" timestamp with time zone,
	"tracklists_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mb_cache_entries" (
	"entity_type" "mb_entity_type" NOT NULL,
	"mbid" uuid NOT NULL,
	"inc" text DEFAULT '' NOT NULL,
	"status" "mb_fetch_status" NOT NULL,
	"http_status" smallint,
	"etag" text,
	"payload" jsonb,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mb_cache_entries_entity_type_mbid_inc_pk" PRIMARY KEY("entity_type","mbid","inc")
);
--> statement-breakpoint
CREATE TABLE "mb_labels" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_name" text,
	"type" text,
	"label_code" integer,
	"country" char(2),
	"disambiguation" text DEFAULT '' NOT NULL,
	"wikidata_qid" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mb_mbid_redirects" (
	"old_mbid" uuid PRIMARY KEY NOT NULL,
	"entity_type" "mb_entity_type" NOT NULL,
	"canonical_mbid" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mb_recording_credits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mb_recording_credits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recording_mbid" uuid NOT NULL,
	"artist_mbid" uuid NOT NULL,
	"artist_name" text NOT NULL,
	"type_id" uuid NOT NULL,
	"type_name" text NOT NULL,
	"attributes" text[] DEFAULT '{}'::text[] NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mb_recordings" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"length_ms" integer,
	"first_release_date" text DEFAULT '' NOT NULL,
	"first_release_year" smallint,
	"video" boolean DEFAULT false NOT NULL,
	"disambiguation" text DEFAULT '' NOT NULL,
	"primary_artist_mbid" uuid,
	"artist_credit" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isrcs" text[] DEFAULT '{}'::text[] NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"rels_fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mb_release_groups" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"primary_type" "rg_primary_type",
	"secondary_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_release_date" text DEFAULT '' NOT NULL,
	"first_release_year" smallint,
	"disambiguation" text DEFAULT '' NOT NULL,
	"primary_artist_mbid" uuid,
	"artist_credit" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artist_credit_count" smallint DEFAULT 1 NOT NULL,
	"is_studio_album" boolean DEFAULT false NOT NULL,
	"has_official_release" boolean,
	"canonical_release_mbid" uuid,
	"wikidata_qid" text,
	"cover_art_url" text,
	"cover_art_checked_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"releases_fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mb_release_labels" (
	"release_mbid" uuid NOT NULL,
	"label_mbid" uuid NOT NULL,
	"catalog_number" text DEFAULT '' NOT NULL,
	CONSTRAINT "mb_release_labels_release_mbid_label_mbid_catalog_number_pk" PRIMARY KEY("release_mbid","label_mbid","catalog_number")
);
--> statement-breakpoint
CREATE TABLE "mb_releases" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"release_group_mbid" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "release_status",
	"date" text DEFAULT '' NOT NULL,
	"date_is_complete" boolean DEFAULT false NOT NULL,
	"year" smallint,
	"country" char(2),
	"barcode" text,
	"packaging" text,
	"quality" text,
	"disambiguation" text DEFAULT '' NOT NULL,
	"medium_count" smallint,
	"track_count" integer,
	"formats" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"canonical_score" integer,
	"tracklist_fetched_at" timestamp with time zone,
	"credits_fetched_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mb_search_cache" (
	"entity_type" "mb_entity_type" NOT NULL,
	"query_key" text NOT NULL,
	"query" text NOT NULL,
	"top_mbid" uuid,
	"top_score" smallint,
	"top_is_unique" boolean DEFAULT false NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mb_search_cache_entity_type_query_key_pk" PRIMARY KEY("entity_type","query_key")
);
--> statement-breakpoint
CREATE TABLE "mb_tracks" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"release_mbid" uuid NOT NULL,
	"recording_mbid" uuid NOT NULL,
	"medium_position" smallint NOT NULL,
	"medium_format" text,
	"medium_track_count" smallint NOT NULL,
	"position" smallint NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"absolute_position" smallint NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"length_ms" integer,
	"is_opener" boolean DEFAULT false NOT NULL,
	"is_closer" boolean DEFAULT false NOT NULL,
	"artist_credit" jsonb
);
--> statement-breakpoint
CREATE TABLE "wd_artist_facts" (
	"mb_artist_mbid" uuid PRIMARY KEY NOT NULL,
	"qid" text NOT NULL,
	"origin_place_qid" text,
	"origin_place_label" text,
	"country_qid" text,
	"country_label" text,
	"country_iso" char(2),
	"inception" text,
	"inception_precision" smallint,
	"dissolved" text,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"record_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wd_entities" (
	"qid" text PRIMARY KEY NOT NULL,
	"label_en" text,
	"description_en" text,
	"enwiki_title" text,
	"redirect_to_qid" text,
	"claims" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wd_entity_links" (
	"entity_type" "mb_entity_type" NOT NULL,
	"mbid" uuid NOT NULL,
	"qid" text,
	"resolution" "wd_resolution" DEFAULT 'pending' NOT NULL,
	"candidate_qids" text[] DEFAULT '{}'::text[] NOT NULL,
	"resolved_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	CONSTRAINT "wd_entity_links_entity_type_mbid_pk" PRIMARY KEY("entity_type","mbid")
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_ms" integer,
	"raw_text" text,
	"raw_json" jsonb,
	"normalized_text" text,
	"is_correct" boolean NOT NULL,
	"grading_method" "grading_method" NOT NULL,
	"grading_score" numeric(5, 4),
	"grading_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points_awarded" smallint DEFAULT 0 NOT NULL,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "llm_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"purpose" "llm_purpose" NOT NULL,
	"cache_key" text,
	"question_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"category" "question_category" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"answer_format" "answer_format" NOT NULL,
	"template_id" text NOT NULL,
	"prompt" text NOT NULL,
	"prompt_rephrased" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"correct_display" text NOT NULL,
	"numeric_answer" numeric(14, 3),
	"numeric_tolerance" numeric(14, 3),
	"anchor_artist_key" text,
	"anchor_artist_mbid" uuid,
	"anchor_release_group_mbid" uuid,
	"anchor_recording_mbid" uuid,
	"anchor_year" smallint,
	"fact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"points" smallint DEFAULT 1 NOT NULL,
	"time_limit_seconds" smallint NOT NULL,
	"served_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" "quiz_mode" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"requested_length" smallint NOT NULL,
	"question_count" smallint DEFAULT 0 NOT NULL,
	"status" "round_status" DEFAULT 'draft' NOT NULL,
	"seed" bigint NOT NULL,
	"generator_version" text NOT NULL,
	"optional_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"stats_snapshot_at" timestamp with time zone,
	"timer_seconds" smallint NOT NULL,
	"current_index" smallint DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"max_score" integer DEFAULT 0 NOT NULL,
	"correct_count" smallint DEFAULT 0 NOT NULL,
	"best_streak" smallint DEFAULT 0 NOT NULL,
	"share_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bracket_entrants" (
	"bracket_id" uuid NOT NULL,
	"seed" smallint NOT NULL,
	"artist_key" text NOT NULL,
	"artist_name" text NOT NULL,
	"artist_mbid" uuid,
	"play_count" integer NOT NULL,
	"eliminated_in_round" smallint,
	CONSTRAINT "bracket_entrants_bracket_id_seed_pk" PRIMARY KEY("bracket_id","seed")
);
--> statement-breakpoint
CREATE TABLE "bracket_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bracket_id" uuid NOT NULL,
	"round_no" smallint NOT NULL,
	"match_no" smallint NOT NULL,
	"seed_a" smallint,
	"seed_b" smallint,
	"winner_seed" smallint,
	"next_match_id" uuid,
	"next_slot" smallint,
	"duel_guess_seed" smallint,
	"duel_correct" boolean,
	"picked_at" timestamp with time zone,
	"duel_answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"size" smallint NOT NULL,
	"round_count" smallint NOT NULL,
	"status" "bracket_status" DEFAULT 'active' NOT NULL,
	"current_round" smallint DEFAULT 1 NOT NULL,
	"champion_seed" smallint,
	"duels_correct" smallint DEFAULT 0 NOT NULL,
	"duels_total" smallint DEFAULT 0 NOT NULL,
	"stats_snapshot_at" timestamp with time zone,
	"share_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "brackets_size_pow2" CHECK ("brackets"."size" in (4, 8, 16, 32))
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lastfm_sessions" ADD CONSTRAINT "lastfm_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sync_state" ADD CONSTRAINT "user_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrobbles" ADD CONSTRAINT "scrobbles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrobbles" ADD CONSTRAINT "scrobbles_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_album_stats" ADD CONSTRAINT "user_album_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_artist_stats" ADD CONSTRAINT "user_artist_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_track_stats" ADD CONSTRAINT "user_track_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_year_artist_stats" ADD CONSTRAINT "user_year_artist_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_recording_credits" ADD CONSTRAINT "mb_recording_credits_recording_mbid_mb_recordings_mbid_fk" FOREIGN KEY ("recording_mbid") REFERENCES "public"."mb_recordings"("mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_release_groups" ADD CONSTRAINT "mb_release_groups_primary_artist_mbid_mb_artists_mbid_fk" FOREIGN KEY ("primary_artist_mbid") REFERENCES "public"."mb_artists"("mbid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_release_labels" ADD CONSTRAINT "mb_release_labels_release_mbid_mb_releases_mbid_fk" FOREIGN KEY ("release_mbid") REFERENCES "public"."mb_releases"("mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_release_labels" ADD CONSTRAINT "mb_release_labels_label_mbid_mb_labels_mbid_fk" FOREIGN KEY ("label_mbid") REFERENCES "public"."mb_labels"("mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_releases" ADD CONSTRAINT "mb_releases_release_group_mbid_mb_release_groups_mbid_fk" FOREIGN KEY ("release_group_mbid") REFERENCES "public"."mb_release_groups"("mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_tracks" ADD CONSTRAINT "mb_tracks_release_mbid_mb_releases_mbid_fk" FOREIGN KEY ("release_mbid") REFERENCES "public"."mb_releases"("mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mb_tracks" ADD CONSTRAINT "mb_tracks_recording_mbid_mb_recordings_mbid_fk" FOREIGN KEY ("recording_mbid") REFERENCES "public"."mb_recordings"("mbid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wd_artist_facts" ADD CONSTRAINT "wd_artist_facts_mb_artist_mbid_mb_artists_mbid_fk" FOREIGN KEY ("mb_artist_mbid") REFERENCES "public"."mb_artists"("mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_round_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."round_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_question_id_round_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."round_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_questions" ADD CONSTRAINT "round_questions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_questions" ADD CONSTRAINT "round_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_entrants" ADD CONSTRAINT "bracket_entrants_bracket_id_brackets_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."brackets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_bracket_id_brackets_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."brackets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_matches" ADD CONSTRAINT "bracket_matches_next_match_id_bracket_matches_id_fk" FOREIGN KEY ("next_match_id") REFERENCES "public"."bracket_matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_uq" ON "app_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "app_sessions_user_idx" ON "app_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_flows_state_uq" ON "auth_flows" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_flows_token_hash_uq" ON "auth_flows" USING btree ("lastfm_token_hash") WHERE "auth_flows"."lastfm_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "auth_flows_expires_idx" ON "auth_flows" USING btree ("expires_at") WHERE "auth_flows"."consumed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "lastfm_sessions_one_active_per_user" ON "lastfm_sessions" USING btree ("user_id") WHERE "lastfm_sessions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "users_lastfm_username_key_uq" ON "users" USING btree ("lastfm_username_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_dedupe_pending_uq" ON "sync_jobs" USING btree ("dedupe_key") WHERE "sync_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "sync_jobs_runnable_idx" ON "sync_jobs" USING btree ("priority","run_after","id") WHERE "sync_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "sync_jobs_lease_idx" ON "sync_jobs" USING btree ("lease_expires_at") WHERE "sync_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "sync_jobs_user_idx" ON "sync_jobs" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "user_sync_state_phase_idx" ON "user_sync_state" USING btree ("phase","last_incremental_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scrobbles_dedupe_uq" ON "scrobbles" USING btree ("user_id","played_at","artist_key","track_key");--> statement-breakpoint
CREATE INDEX "scrobbles_user_artist_time_idx" ON "scrobbles" USING btree ("user_id","artist_key","played_at");--> statement-breakpoint
CREATE INDEX "scrobbles_user_time_idx" ON "scrobbles" USING btree ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "user_album_stats_in_artist_idx" ON "user_album_stats" USING btree ("user_id","artist_key","rank_in_artist");--> statement-breakpoint
CREATE INDEX "user_album_stats_overall_idx" ON "user_album_stats" USING btree ("user_id","rank_overall");--> statement-breakpoint
CREATE UNIQUE INDEX "user_artist_stats_rank_uq" ON "user_artist_stats" USING btree ("user_id","rank");--> statement-breakpoint
CREATE INDEX "user_artist_stats_difficulty_idx" ON "user_artist_stats" USING btree ("user_id","difficulty","rank");--> statement-breakpoint
CREATE INDEX "user_artist_stats_first_played_idx" ON "user_artist_stats" USING btree ("user_id","first_played_at");--> statement-breakpoint
CREATE INDEX "user_track_stats_in_artist_idx" ON "user_track_stats" USING btree ("user_id","artist_key","rank_in_artist");--> statement-breakpoint
CREATE INDEX "user_track_stats_overall_idx" ON "user_track_stats" USING btree ("user_id","rank_overall");--> statement-breakpoint
CREATE UNIQUE INDEX "user_year_artist_stats_rank_uq" ON "user_year_artist_stats" USING btree ("user_id","year","rank_in_year");--> statement-breakpoint
CREATE INDEX "artist_resolutions_mbid_idx" ON "artist_resolutions" USING btree ("mbid") WHERE "artist_resolutions"."mbid" is not null;--> statement-breakpoint
CREATE INDEX "artist_resolutions_retry_idx" ON "artist_resolutions" USING btree ("next_attempt_at") WHERE "artist_resolutions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "mb_artist_relations_stint_uq" ON "mb_artist_relations" USING btree ("entity0_mbid","entity1_mbid","type_id",coalesce("begin_date", ''),coalesce("end_date", ''));--> statement-breakpoint
CREATE INDEX "mb_artist_relations_entity1_idx" ON "mb_artist_relations" USING btree ("entity1_mbid","type_id");--> statement-breakpoint
CREATE INDEX "mb_artist_relations_entity0_idx" ON "mb_artist_relations" USING btree ("entity0_mbid","type_id");--> statement-breakpoint
CREATE INDEX "mb_artists_name_key_idx" ON "mb_artists" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "mb_artists_wikidata_idx" ON "mb_artists" USING btree ("wikidata_qid") WHERE "mb_artists"."wikidata_qid" is not null;--> statement-breakpoint
CREATE INDEX "mb_cache_entries_expires_idx" ON "mb_cache_entries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mb_mbid_redirects_canonical_idx" ON "mb_mbid_redirects" USING btree ("canonical_mbid");--> statement-breakpoint
CREATE UNIQUE INDEX "mb_recording_credits_uq" ON "mb_recording_credits" USING btree ("recording_mbid","artist_mbid","type_id");--> statement-breakpoint
CREATE INDEX "mb_recording_credits_artist_idx" ON "mb_recording_credits" USING btree ("artist_mbid","type_id");--> statement-breakpoint
CREATE INDEX "mb_recordings_artist_title_idx" ON "mb_recordings" USING btree ("primary_artist_mbid","title_key");--> statement-breakpoint
CREATE INDEX "mb_release_groups_studio_idx" ON "mb_release_groups" USING btree ("primary_artist_mbid","first_release_year") WHERE "mb_release_groups"."is_studio_album" = true;--> statement-breakpoint
CREATE INDEX "mb_release_groups_artist_title_idx" ON "mb_release_groups" USING btree ("primary_artist_mbid","title_key");--> statement-breakpoint
CREATE INDEX "mb_release_labels_label_idx" ON "mb_release_labels" USING btree ("label_mbid");--> statement-breakpoint
CREATE UNIQUE INDEX "mb_releases_one_canonical_uq" ON "mb_releases" USING btree ("release_group_mbid") WHERE "mb_releases"."is_canonical" = true;--> statement-breakpoint
CREATE INDEX "mb_releases_group_status_idx" ON "mb_releases" USING btree ("release_group_mbid","status","date");--> statement-breakpoint
CREATE INDEX "mb_search_cache_expires_idx" ON "mb_search_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mb_tracks_position_uq" ON "mb_tracks" USING btree ("release_mbid","medium_position","position");--> statement-breakpoint
CREATE INDEX "mb_tracks_release_abs_idx" ON "mb_tracks" USING btree ("release_mbid","absolute_position");--> statement-breakpoint
CREATE INDEX "mb_tracks_recording_idx" ON "mb_tracks" USING btree ("recording_mbid");--> statement-breakpoint
CREATE INDEX "mb_tracks_release_title_idx" ON "mb_tracks" USING btree ("release_mbid","title_key");--> statement-breakpoint
CREATE INDEX "wd_entities_expires_idx" ON "wd_entities" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "wd_entity_links_retry_idx" ON "wd_entity_links" USING btree ("next_retry_at") WHERE "wd_entity_links"."resolution" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_uq" ON "answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answers_round_idx" ON "answers" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_calls_cache_key_uq" ON "llm_calls" USING btree ("cache_key") WHERE "llm_calls"."cache_key" is not null;--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "round_questions_position_uq" ON "round_questions" USING btree ("round_id","position");--> statement-breakpoint
CREATE INDEX "round_questions_fingerprint_idx" ON "round_questions" USING btree ("user_id","fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "rounds_user_created_idx" ON "rounds" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_share_slug_uq" ON "rounds" USING btree ("share_slug") WHERE "rounds"."share_slug" is not null;--> statement-breakpoint
CREATE INDEX "rounds_leaderboard_idx" ON "rounds" USING btree ("mode","difficulty","score") WHERE "rounds"."status" = 'completed';--> statement-breakpoint
CREATE UNIQUE INDEX "bracket_entrants_artist_uq" ON "bracket_entrants" USING btree ("bracket_id","artist_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bracket_matches_slot_uq" ON "bracket_matches" USING btree ("bracket_id","round_no","match_no");--> statement-breakpoint
CREATE INDEX "bracket_matches_next_idx" ON "bracket_matches" USING btree ("next_match_id");--> statement-breakpoint
CREATE INDEX "brackets_user_created_idx" ON "brackets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brackets_share_slug_uq" ON "brackets" USING btree ("share_slug") WHERE "brackets"."share_slug" is not null;