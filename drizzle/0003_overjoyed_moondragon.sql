DROP INDEX "players_team_canonical_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "players_team_canonical_idx" ON "players" USING btree ("team_id","canonical_name");