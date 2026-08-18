DROP INDEX "players_sorare_slug_idx";--> statement-breakpoint
CREATE INDEX "players_sorare_slug_idx" ON "players" USING btree ("sorare_slug");