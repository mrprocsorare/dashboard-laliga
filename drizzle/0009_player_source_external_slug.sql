ALTER TABLE "player_source_ids" ADD COLUMN "external_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "player_source_ids_source_slug_idx" ON "player_source_ids" USING btree ("source_id","external_slug");--> statement-breakpoint
-- Backfill: las filas legadas tienen el slug en `external_player_id` (no teníamos
-- el `id` estable en el momento del backfill). Lo copiamos a `external_slug`
-- para que el lookup de cache funcione ya; el incremental irá rellenando
-- `external_player_id` con el `id` estable al re-verificar cada jugador.
UPDATE "player_source_ids" SET "external_slug" = "external_player_id" WHERE "external_slug" IS NULL AND "external_player_id" IS NOT NULL;