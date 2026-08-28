import "dotenv/config";
import { notInArray, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sources, teams } from "./schema";

/**
 * Catálogo base. Idempotente: no duplica si ya existen (conflict by slug).
 * NOTA: el catálogo de equipos/jugadores se refinará en Fase 2 cuando los
 * scrapers empiecen a entregar datos reales de la temporada en curso.
 */
const SOURCES = [
  { slug: "futbolfantasy", name: "FutbolFantasy", baseUrl: "https://www.futbolfantasy.com" },
  { slug: "analiticafantasy", name: "AnalíticaFantasy", baseUrl: "https://www.analiticafantasy.com" },
  { slug: "jornadaperfecta", name: "JornadaPerfecta", baseUrl: "https://www.jornadaperfecta.com" },
  { slug: "comuniate", name: "Comuniate", baseUrl: "https://www.comuniate.com" },
  { slug: "sorare", name: "Sorare", baseUrl: "https://sorare.com" },
];

/**
 * Roster 26/27 (según la navegación oficial de Comuniate).
 * El seed es idempotente (upsert por slug) y además deja la tabla de equipos
 * limpia: elimina los slugs que ya no están en el catálogo.
 */
const TEAMS = [
  { slug: "alaves", name: "Deportivo Alavés", shortName: "ALA" },
  { slug: "athletic-bilbao", name: "Athletic Club", shortName: "ATH" },
  { slug: "atletico-madrid", name: "Atlético de Madrid", shortName: "ATM" },
  { slug: "barcelona", name: "FC Barcelona", shortName: "BAR" },
  { slug: "real-betis", name: "Real Betis Balompié", shortName: "BET" },
  { slug: "celta-vigo", name: "RC Celta de Vigo", shortName: "CEL" },
  { slug: "deportivo-la-coruna", name: "Deportivo de La Coruña", shortName: "DEP" },
  { slug: "elche", name: "Elche CF", shortName: "ELC" },
  { slug: "espanyol", name: "RCD Espanyol", shortName: "ESP" },
  { slug: "getafe", name: "Getafe CF", shortName: "GET" },
  { slug: "levante", name: "Levante UD", shortName: "LEV" },
  { slug: "malaga", name: "Málaga CF", shortName: "MAL" },
  { slug: "osasuna", name: "CA Osasuna", shortName: "OSA" },
  { slug: "racing-santander", name: "Racing de Santander", shortName: "RAC" },
  { slug: "rayo-vallecano", name: "Rayo Vallecano", shortName: "RAY" },
  { slug: "real-madrid", name: "Real Madrid CF", shortName: "RMA" },
  { slug: "real-sociedad", name: "Real Sociedad", shortName: "RSO" },
  { slug: "sevilla", name: "Sevilla FC", shortName: "SEV" },
  { slug: "valencia", name: "Valencia CF", shortName: "VAL" },
  { slug: "villarreal", name: "Villarreal CF", shortName: "VIL" },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Falta DATABASE_URL en el entorno. Abortando.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  console.log("Sembrando fuentes...");
  await db.insert(sources).values(SOURCES).onConflictDoNothing({ target: sources.slug });
  console.log(`  ${SOURCES.length} fuentes (skipped si ya existían)`);

  // Elimina fuentes que ya no están en el catálogo (cascade borra sus datos).
  const canonicalSourceSlugs = SOURCES.map((s) => s.slug);
  const staleSources = await db
    .select()
    .from(sources)
    .where(notInArray(sources.slug, canonicalSourceSlugs));
  if (staleSources.length) {
    await db
      .delete(sources)
      .where(inArray(sources.slug, staleSources.map((s) => s.slug)));
    console.log(
      `  → Eliminadas ${staleSources.length} fuentes obsoletas: ${staleSources.map((s) => s.slug).join(", ")}`,
    );
  }

  console.log("Sembrando equipos...");
  await db.insert(teams).values(TEAMS).onConflictDoNothing({ target: teams.slug });
  console.log(`  ${TEAMS.length} equipos (skipped si ya existían)`);

  const canonicalSlugs = TEAMS.map((t) => t.slug);
  const stale = await db.select().from(teams).where(notInArray(teams.slug, canonicalSlugs));
  if (stale.length) {
    await db.delete(teams).where(inArray(teams.slug, stale.map((t) => t.slug)));
    console.log(`  → Eliminados ${stale.length} equipos obsoletos: ${stale.map((t) => t.slug).join(", ")}`);
  } else {
    console.log("  → Sin equipos obsoletos.");
  }

  await pool.end();
  console.log("Seed completado.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
