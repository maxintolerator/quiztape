-- Bracket mode is gone; a saved default of 'bracket' would block the enum rebuild below.
UPDATE "user_settings" SET "default_mode" = 'mixtape' WHERE "default_mode" = 'bracket';--> statement-breakpoint
DROP TABLE "auth_flows" CASCADE;--> statement-breakpoint
DROP TABLE "lastfm_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "bracket_entrants" CASCADE;--> statement-breakpoint
DROP TABLE "bracket_matches" CASCADE;--> statement-breakpoint
DROP TABLE "brackets" CASCADE;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_mode" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_mode" SET DEFAULT 'mixtape'::text;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "mode" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."quiz_mode";--> statement-breakpoint
CREATE TYPE "public"."quiz_mode" AS ENUM('side_a', 'side_b', 'mixtape');--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_mode" SET DEFAULT 'mixtape'::"public"."quiz_mode";--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_mode" SET DATA TYPE "public"."quiz_mode" USING "default_mode"::"public"."quiz_mode";--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "mode" SET DATA TYPE "public"."quiz_mode" USING "mode"::"public"."quiz_mode";--> statement-breakpoint
DROP TYPE "public"."bracket_status";--> statement-breakpoint
DROP TYPE "public"."lastfm_session_status";