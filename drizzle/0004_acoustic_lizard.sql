CREATE TABLE "match_odds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_event_id" text NOT NULL,
	"home_team_id" uuid,
	"away_team_id" uuid,
	"home_team_name" text NOT NULL,
	"away_team_name" text NOT NULL,
	"commence_time" timestamp with time zone NOT NULL,
	"matchday" integer,
	"probability_home_pct" integer,
	"probability_draw_pct" integer,
	"probability_away_pct" integer,
	"bookmaker" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_odds_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
ALTER TABLE "match_odds" ADD CONSTRAINT "match_odds_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_odds" ADD CONSTRAINT "match_odds_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_odds_event_idx" ON "match_odds" USING btree ("external_event_id");--> statement-breakpoint
CREATE INDEX "match_odds_commence_idx" ON "match_odds" USING btree ("commence_time");--> statement-breakpoint
CREATE INDEX "match_odds_matchday_idx" ON "match_odds" USING btree ("matchday");