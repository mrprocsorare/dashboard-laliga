CREATE TYPE "public"."event_severity" AS ENUM('none', 'light', 'moderate', 'serious', 'out');--> statement-breakpoint
CREATE TYPE "public"."player_event_type" AS ENUM('injury', 'suspension', 'doubt', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('POR', 'DEF', 'MED', 'DEL');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "latest_player_forecast" (
	"player_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"probability_pct" integer NOT NULL,
	"is_certain" boolean DEFAULT false NOT NULL,
	"note" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_player_forecast_player_id_source_id_pk" PRIMARY KEY("player_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "latest_set_pieces" (
	"team_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"penalty_takers" jsonb,
	"corner_takers" jsonb,
	"free_kick_takers" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_set_pieces_team_id_source_id_pk" PRIMARY KEY("team_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "latest_team_info" (
	"team_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"coach" text,
	"formation" text,
	"news" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_team_info_team_id_source_id_pk" PRIMARY KEY("team_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "player_consensus" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"probability_pct" integer NOT NULL,
	"sources_total" integer DEFAULT 0 NOT NULL,
	"sources_starter" integer DEFAULT 0 NOT NULL,
	"agreement" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_type" "player_event_type" NOT NULL,
	"severity" "event_severity" DEFAULT 'none' NOT NULL,
	"reason" text,
	"expected_return" text,
	"note" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" "position",
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reliability_weight" text DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "team_consensus" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"formation" text,
	"coach" text,
	"set_pieces" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "latest_player_forecast" ADD CONSTRAINT "latest_player_forecast_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_player_forecast" ADD CONSTRAINT "latest_player_forecast_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_set_pieces" ADD CONSTRAINT "latest_set_pieces_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_set_pieces" ADD CONSTRAINT "latest_set_pieces_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_team_info" ADD CONSTRAINT "latest_team_info_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_team_info" ADD CONSTRAINT "latest_team_info_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_consensus" ADD CONSTRAINT "player_consensus_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_events" ADD CONSTRAINT "player_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_events" ADD CONSTRAINT "player_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_consensus" ADD CONSTRAINT "team_consensus_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "latest_player_forecast_player_idx" ON "latest_player_forecast" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "latest_set_pieces_team_idx" ON "latest_set_pieces" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "latest_team_info_team_idx" ON "latest_team_info" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "player_events_player_idx" ON "player_events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_events_type_idx" ON "player_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "players_team_name_idx" ON "players" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_source_idx" ON "scrape_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_started_idx" ON "scrape_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_slug_idx" ON "sources" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" USING btree ("slug");