import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  const sorareSource = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.slug, "sorare"))
    .limit(1);
  const sourceId = sorareSource[0]?.id ?? null;
  const rows = await db
    .select({
      playerId: schema.players.id,
      playerName: schema.players.name,
      teamName: schema.teams.name,
      status: schema.playerSourceIds.status,
      slug: schema.playerSourceIds.externalPlayerId,
      reason: schema.playerSourceIds.reason,
      confidence: schema.playerSourceIds.confidence,
      lastVerifiedAt: schema.playerSourceIds.lastVerifiedAt,
    })
    .from(schema.players)
    .innerJoin(schema.teams, eq(schema.players.teamId, schema.teams.id))
    .leftJoin(
      schema.playerSourceIds,
      and(eq(schema.players.id, schema.playerSourceIds.playerId), eq(schema.playerSourceIds.sourceId, sourceId as string)),
    );
  const teamStats = new Map<string, { total: number; matched: number; pending: number; notFound: number }>();
  const doubtful = rows.filter((row) => row.status !== "matched");
  for (const row of rows) {
    const stats = teamStats.get(row.teamName) ?? { total: 0, matched: 0, pending: 0, notFound: 0 };
    stats.total++;
    if (row.status === "matched" && row.slug) stats.matched++;
    else if (row.status === "not_found") stats.notFound++;
    else stats.pending++;
    teamStats.set(row.teamName, stats);
  }
  const matched = rows.filter((row) => row.status === "matched" && row.slug).length;
  const notFound = rows.filter((row) => row.status === "not_found").length;
  const report = {
    generatedAt: new Date().toISOString(),
    playersTotal: rows.length,
    matched,
    pending: rows.length - matched - notFound,
    notFound,
    coveragePct: rows.length ? Number(((matched / rows.length) * 100).toFixed(2)) : 0,
    teams: [...teamStats.entries()].sort(([left], [right]) => left.localeCompare(right, "es")).map(([name, stats]) => ({
      name,
      ...stats,
      coveragePct: stats.total ? Number(((stats.matched / stats.total) * 100).toFixed(2)) : 0,
    })),
    doubtful: doubtful.map((row) => ({
      playerId: row.playerId,
      playerName: row.playerName,
      team: row.teamName,
      status: row.status ?? "not_found",
      slug: row.slug,
      reason: row.reason ?? "sin_mapping",
      confidence: row.confidence,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    })),
  };
  console.log(`Jugadores totales: ${report.playersTotal}`);
  console.log(`Con Sorare: ${report.matched}`);
  console.log(`Pendientes: ${report.pending}`);
  console.log(`No encontrados: ${report.notFound}`);
  console.log(`Cobertura: ${report.coveragePct.toFixed(2)}%`);
  for (const team of report.teams) {
    console.log(`${team.name}: ${team.matched}/${team.total} (${team.coveragePct.toFixed(2)}%)`);
  }
  if (report.doubtful.length) {
    console.log("\nCasos dudosos/no encontrados:");
    for (const row of report.doubtful) console.log(`- ${row.playerName} (${row.team}): ${row.status} · ${row.reason}`);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
