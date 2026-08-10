import "dotenv/config";
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
  { slug: "sportsgambler", name: "SportsGambler", baseUrl: "https://www.sportsgambler.com" },
  { slug: "comuniate", name: "Comuniate", baseUrl: "https://www.comuniate.com" },
];

const TEAMS = [
  { slug: "real-madrid", name: "Real Madrid", shortName: "RMA" },
  { slug: "barcelona", name: "FC Barcelona", shortName: "BAR" },
  { slug: "atletico-madrid", name: "Atlético de Madrid", shortName: "ATM" },
  { slug: "athletic-bilbao", name: "Athletic Club", shortName: "ATH" },
  { slug: "villarreal", name: "Villarreal CF", shortName: "VIL" },
  { slug: "real-betis", name: "Real Betis", shortName: "BET" },
  { slug: "real-sociedad", name: "Real Sociedad", shortName: "RSO" },
  { slug: "celta-vigo", name: "Celta de Vigo", shortName: "CEL" },
  { slug: "sevilla", name: "Sevilla FC", shortName: "SEV" },
  { slug: "valencia", name: "Valencia CF", shortName: "VAL" },
  { slug: "girona", name: "Girona FC", shortName: "GIR" },
  { slug: "osasuna", name: "CA Osasuna", shortName: "OSA" },
  { slug: "mallorca", name: "RCD Mallorca", shortName: "MLL" },
  { slug: "rayo-vallecano", name: "Rayo Vallecano", shortName: "RAY" },
  { slug: "alaves", name: "Deportivo Alavés", shortName: "ALA" },
  { slug: "getafe", name: "Getafe CF", shortName: "GET" },
  { slug: "espanyol", name: "RCD Espanyol", shortName: "ESP" },
  { slug: "leganes", name: "CD Leganés", shortName: "LEG" },
  { slug: "valladolid", name: "Real Valladolid", shortName: "VLL" },
  { slug: "oviedo", name: "Real Oviedo", shortName: "OVD" },
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

  console.log("Sembrando equipos...");
  await db.insert(teams).values(TEAMS).onConflictDoNothing({ target: teams.slug });
  console.log(`  ${TEAMS.length} equipos (skipped si ya existían)`);

  await pool.end();
  console.log("Seed completado.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
