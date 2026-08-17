/**
 * Lista los forecasts que no pudieron matchear contra el roster canónico del
 * equipo correspondiente. Cada fila contiene:
 *  - El nombre crudo tal y como lo escribió la fuente.
 *  - El equipo y la fuente.
 *  - La fecha.
 *  - Si está resuelto (assigned a un player_id manualmente) o pendiente.
 *
 * Uso:
 *   npm run audit:unmatched
 *
 * Estos forecasts se acumulan en `unmatched_forecasts` cuando un nombre
 * scrapeado no se parece a ninguno del roster cerrado (Wikipedia). La causa
 * típica es un fichaje reciente que aún no aparece en la plantilla de
 * Wikipedia, así que toca revisarlos y, si aplica, añadirlos al roster.
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, isNull, sql, desc } from "drizzle-orm";
import * as schema from "../database/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  // Totales por estado.
  const totals = await db
    .select({
      status: sql<string>`CASE WHEN ${schema.unmatchedForecasts.resolvedPlayerId} IS NULL THEN 'pending' ELSE 'resolved' END`.as("status"),
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(schema.unmatchedForecasts)
    .groupBy(sql`1`);
  console.log("=== Totales unmatched_forecasts ===");
  if (!totals.length) console.log("(ninguno)");
  for (const t of totals) console.log(`  ${t.status}: ${t.n}`);

  // Pendientes por equipo.
  const pendingByTeam = await db
    .select({
      teamSlug: schema.teams.slug,
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(schema.unmatchedForecasts)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.unmatchedForecasts.teamId))
    .where(isNull(schema.unmatchedForecasts.resolvedPlayerId))
    .groupBy(schema.teams.slug)
    .orderBy(desc(sql`count(*)`));
  console.log("\n=== Pendientes por equipo ===");
  if (!pendingByTeam.length) console.log("(ninguno pendiente)");
  for (const p of pendingByTeam) console.log(`  ${p.teamSlug}: ${p.n}`);

  // Top 20 pendientes más recientes.
  const recent = await db
    .select({
      rawName: schema.unmatchedForecasts.rawName,
      normalizedName: schema.unmatchedForecasts.normalizedName,
      teamSlug: schema.teams.slug,
      sourceSlug: schema.sources.slug,
      fetchedAt: schema.unmatchedForecasts.fetchedAt,
    })
    .from(schema.unmatchedForecasts)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.unmatchedForecasts.teamId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.unmatchedForecasts.sourceId))
    .where(isNull(schema.unmatchedForecasts.resolvedPlayerId))
    .orderBy(desc(schema.unmatchedForecasts.fetchedAt))
    .limit(20);
  console.log("\n=== 20 pendientes más recientes ===");
  if (!recent.length) console.log("(ninguno)");
  for (const r of recent) {
    console.log(`  ${r.teamSlug.padEnd(20)} | ${r.sourceSlug.padEnd(15)} | ${r.rawName}`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
