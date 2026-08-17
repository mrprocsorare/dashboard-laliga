CREATE TABLE "unmatched_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"raw_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"probability_pct" integer,
	"is_certain" boolean DEFAULT false NOT NULL,
	"forecast_type" "forecast_type" DEFAULT 'probable' NOT NULL,
	"note" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_player_id" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "canonical_name" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "is_canonical_roster" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unmatched_forecasts" ADD CONSTRAINT "unmatched_forecasts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_forecasts" ADD CONSTRAINT "unmatched_forecasts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_forecasts" ADD CONSTRAINT "unmatched_forecasts_resolved_player_id_players_id_fk" FOREIGN KEY ("resolved_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unmatched_team_idx" ON "unmatched_forecasts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "unmatched_source_idx" ON "unmatched_forecasts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "unmatched_resolved_idx" ON "unmatched_forecasts" USING btree ("resolved_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_team_canonical_idx" ON "players" USING btree ("team_id","canonical_name") WHERE canonical_name IS NOT NULL;