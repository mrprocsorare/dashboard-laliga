import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { slugVariants } from "../lib/sorare-slugs";

const SOURCE_SLUG = "sorare";

const CSV_HEADERS = [
  "player_id",
  "nombre_actual",
  "canonical_name",
  "equipo",
  "posicion",
  "fecha_nacimiento",
  "nacionalidad",
  "variantes_slug",
  "legacy_sorare_slug",
  "external_player_id",
  "external_slug",
  "motivo",
  // Columnas preparadas para completar manualmente:
  "sorare_player_id",
  "sorare_slug",
  "confidence",
  "verification_status",
  "verification_source",
  "notes",
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(values: readonly (string | null | undefined)[]): string {
  return values.map(csvEscape).join(",");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const rows = await db
    .select({
      playerId: schema.playerSourceIds.playerId,
      nombreActual: schema.players.name,
      canonicalName: schema.players.canonicalName,
      equipo: schema.teams.name,
      posicion: schema.players.position,
      fechaNacimiento: schema.players.dateOfBirth,
      nacionalidad: schema.players.nationality,
      legacySorareSlug: schema.players.sorareSlug,
      externalPlayerId: schema.playerSourceIds.externalPlayerId,
      externalSlug: schema.playerSourceIds.externalSlug,
      motivo: schema.playerSourceIds.reason,
    })
    .from(schema.playerSourceIds)
    .innerJoin(schema.players, eq(schema.playerSourceIds.playerId, schema.players.id))
    .innerJoin(schema.teams, eq(schema.players.teamId, schema.teams.id))
    .innerJoin(schema.sources, eq(schema.playerSourceIds.sourceId, schema.sources.id))
    .where(
      and(
        eq(schema.sources.slug, SOURCE_SLUG),
        eq(schema.playerSourceIds.status, "not_found"),
      ),
    )
    .orderBy(schema.teams.name, schema.players.name);

  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    const variantes = slugVariants({
      name: r.nombreActual,
      canonicalName: r.canonicalName,
    }).join(" | ");
    lines.push(
      toCsvRow([
        r.playerId,
        r.nombreActual,
        r.canonicalName,
        r.equipo,
        r.posicion ?? "",
        r.fechaNacimiento ?? "",
        r.nacionalidad ?? "",
        variantes,
        r.legacySorareSlug ?? "",
        r.externalPlayerId ?? "",
        r.externalSlug ?? "",
        r.motivo ?? "",
        "", // sorare_player_id
        "", // sorare_slug
        "", // confidence
        "", // verification_status
        "", // verification_source
        "", // notes
      ]),
    );
  }

  const outDir = join(process.cwd(), "data", "sorare");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `not_found_${SOURCE_SLUG}_${stamp}.csv`);
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  await pool.end();
  console.log(`Exportados ${rows.length} jugadores en: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
