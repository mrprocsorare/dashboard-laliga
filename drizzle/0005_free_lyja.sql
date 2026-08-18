ALTER TABLE "players" ADD COLUMN "sorare_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "players_sorare_slug_idx" ON "players" USING btree ("sorare_slug");