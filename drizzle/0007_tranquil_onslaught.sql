CREATE TYPE "public"."sorare_mapping_status" AS ENUM('matched', 'manual_review', 'not_found');--> statement-breakpoint
CREATE TABLE "sorare_player_cache" (
	"sorare_slug" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"first_name" text,
	"last_name" text,
	"birth_day" text,
	"nationality" text,
	"active_club_name" text,
	"active_club_slug" text,
	"scores" jsonb,
	"average_score" real,
	"latest_score" real,
	"scores_updated_at" timestamp with time zone,
	"scores_expires_at" timestamp with time zone,
	"classic_price_eur_cents" integer,
	"classic_card_slug" text,
	"classic_updated_at" timestamp with time zone,
	"classic_expires_at" timestamp with time zone,
	"in_season_price_eur_cents" integer,
	"in_season_card_slug" text,
	"in_season_updated_at" timestamp with time zone,
	"in_season_expires_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sorare_player_mappings" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"sorare_slug" text,
	"display_name" text,
	"first_name" text,
	"last_name" text,
	"birth_day" text,
	"nationality" text,
	"active_club_name" text,
	"active_club_slug" text,
	"matching_method" text DEFAULT 'not_found' NOT NULL,
	"confidence" real,
	"status" "sorare_mapping_status" DEFAULT 'not_found' NOT NULL,
	"reason" text,
	"candidates" jsonb,
	"last_verified_at" timestamp with time zone,
	"identity_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sorare_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"players_total" integer DEFAULT 0 NOT NULL,
	"mappings_matched" integer DEFAULT 0 NOT NULL,
	"mappings_pending" integer DEFAULT 0 NOT NULL,
	"mappings_not_found" integer DEFAULT 0 NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "date_of_birth" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "sorare_player_mappings" ADD CONSTRAINT "sorare_player_mappings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sorare_player_cache_scores_expiry_idx" ON "sorare_player_cache" USING btree ("scores_expires_at");--> statement-breakpoint
CREATE INDEX "sorare_player_cache_classic_expiry_idx" ON "sorare_player_cache" USING btree ("classic_expires_at");--> statement-breakpoint
CREATE INDEX "sorare_player_cache_in_season_expiry_idx" ON "sorare_player_cache" USING btree ("in_season_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sorare_player_mappings_slug_idx" ON "sorare_player_mappings" USING btree ("sorare_slug");--> statement-breakpoint
CREATE INDEX "sorare_player_mappings_status_idx" ON "sorare_player_mappings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sorare_player_mappings_expiry_idx" ON "sorare_player_mappings" USING btree ("identity_expires_at");--> statement-breakpoint
CREATE INDEX "sorare_sync_runs_started_idx" ON "sorare_sync_runs" USING btree ("started_at");