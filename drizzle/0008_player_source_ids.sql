CREATE TABLE "player_source_ids" (
	"player_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_player_id" text,
	"external_name" text,
	"external_dob" text,
	"external_club" text,
	"confidence" real,
	"match_method" text DEFAULT 'not_found' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"status" "sorare_mapping_status" DEFAULT 'not_found' NOT NULL,
	"candidates" jsonb,
	"reason" text,
	"last_verified_at" timestamp with time zone,
	"identity_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_source_ids_player_id_source_id_pk" PRIMARY KEY("player_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "player_source_ids" ADD CONSTRAINT "player_source_ids_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_source_ids" ADD CONSTRAINT "player_source_ids_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_source_ids_source_ext_idx" ON "player_source_ids" USING btree ("source_id","external_player_id");--> statement-breakpoint
CREATE INDEX "player_source_ids_status_idx" ON "player_source_ids" USING btree ("status");--> statement-breakpoint
CREATE INDEX "player_source_ids_expiry_idx" ON "player_source_ids" USING btree ("identity_expires_at");--> statement-breakpoint
-- Backfill seguro desde la tabla legada `sorare_player_mappings`.
-- 1) Asegura la existencia de la fuente 'sorare' en el catálogo `sources`.
--    UUID fijo para determinismo; si ya existe otro 'sorare' (p. ej. del seed),
--    se respeta el existente y el backfill lo usa por slug.
INSERT INTO "sources" ("id", "slug", "name", "base_url", "reliability_weight")
VALUES ('00000000-0000-0000-0000-0000000000a1'::uuid, 'sorare', 'Sorare', 'https://sorare.com', '1')
ON CONFLICT (slug) DO NOTHING;--> statement-breakpoint
-- 2) Copia todos los mappings legados. `matched` => is_verified=true; el resto
--    conserva su estado y queda como `manual_review`/`not_found`. Idempotente:
--    re-ejecutar no duplica gracias al ON CONFLICT sobre la PK.
INSERT INTO "player_source_ids" (
  "player_id", "source_id", "external_player_id", "external_name", "external_dob",
  "external_club", "confidence", "match_method", "is_verified", "status",
  "candidates", "reason", "last_verified_at", "identity_expires_at", "created_at", "updated_at"
)
SELECT
  m."player_id",
  (SELECT "id" FROM "sources" WHERE "slug" = 'sorare'),
  m."sorare_slug",
  m."display_name",
  m."birth_day",
  m."active_club_name",
  m."confidence",
  m."matching_method",
  CASE WHEN m."status" = 'matched' THEN true ELSE false END,
  m."status",
  m."candidates",
  m."reason",
  m."last_verified_at",
  m."identity_expires_at",
  m."created_at",
  m."updated_at"
FROM "sorare_player_mappings" m
WHERE m."player_id" IN (SELECT "id" FROM "players")
ON CONFLICT ("player_id", "source_id") DO NOTHING;