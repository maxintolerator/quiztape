ALTER TABLE "auth_flows" ADD COLUMN "exchange_code_hash" text;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD COLUMN "exchange_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD COLUMN "exchanged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD COLUMN "app_session_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_app_session_id_app_sessions_id_fk" FOREIGN KEY ("app_session_id") REFERENCES "public"."app_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_flows_exchange_code_uq" ON "auth_flows" USING btree ("exchange_code_hash") WHERE "auth_flows"."exchange_code_hash" is not null;