/**
 * "Near misses" — pares de jugadores del mismo equipo cuya similitud cae
 * en una zona intermedia (0.55–0.85). Ni tan alta como para fusionar
 * automáticamente, ni tan baja como para ignorar. Esto habría detectado
 * "Álex Grimaldo" / "Alejandro Grimaldo" ANTES de que apareciera como
 * duplicado visible en el dashboard.
 *
 * El score se calcula contra el roster canónico de cada equipo (los
 * jugadores con `is_canonical_roster = true`). Para cada fila
 * NO-canónica del mismo equipo, calculamos el score de matching con
 * `nearMisses()` y listamos los que caen en la zona.
 *
 * Zona por defecto: 0.55–0.85. Ajustable con flags --min y --max.
 *
 * Uso:
 *   npm run audit:near-misses
 *   npx tsx scripts/audit-near-misses.ts --min 0.5 --max 0.9
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { nearMisses } from "../lib/match";
import { loadRosterFromDb } from "../lib/roster-cache";

interface NearMissRow {
  teamSlug: string;
  rawPlayer: { id: string; name: string };
  rosterCandidate: { id: string; name: string };
  confidence: number;
  rule: string;
}

async function main() {
  const args = process.argv.slice(2);
  let minScore = 0.55;
  let maxScore = 0.85;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--min" && args[i + 1]) minScore = parseFloat(args[i + 1]);
    if (args[i] === "--max" && args[i + 1]) maxScore = parseFloat(args[i + 1]);
  }

  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  await loadRosterFromDb(pool);

  const teams = await db
    .select({ id: schema.teams.id, slug: schema.teams.slug })
    .from(schema.teams);

  const allRows: NearMissRow[] = [];

  for (const team of teams) {
    const all = await db
      .select({
        id: schema.players.id,
        name: schema.players.name,
        isCanonicalRoster: schema.players.isCanonicalRoster,
        canonicalName: schema.players.canonicalName,
        position: schema.players.position,
      })
      .from(schema.players)
      .where(eq(schema.players.teamId, team.id));

    const roster = all.filter((p) => p.isCanonicalRoster && p.canonicalName);
    if (!roster.length) continue;

    const rosterShape = roster.map((p) => ({
      name: p.canonicalName as string,
      pos: (p.position ?? "MED") as "POR" | "DEF" | "MED" | "DEL",
    }));

    const nonCanonical = all.filter((p) => !p.isCanonicalRoster);

    for (const nc of nonCanonical) {
      const matches = nearMisses(nc.name, rosterShape);
      for (const m of matches) {
        if (m.confidence >= minScore && m.confidence <= maxScore) {
          const leader = roster[m.index];
          if (!leader) continue;
          allRows.push({
            teamSlug: team.slug,
            rawPlayer: { id: nc.id, name: nc.name },
            rosterCandidate: { id: leader.id, name: leader.name },
            confidence: m.confidence,
            rule: m.rule,
          });
        }
      }
    }
  }

  // Ordenar por score descendente para ver los más sospechosos primero.
  allRows.sort((a, b) => b.confidence - a.confidence);

  console.log(
    `Zona de near-miss: ${minScore.toFixed(2)}–${maxScore.toFixed(2)}. Encontrados: ${allRows.length}\n`,
  );
  if (!allRows.length) {
    console.log("(ninguno en esa zona — buena señal: el roster cubre todos los huérfanos)");
  } else {
    console.log(
      "team                | huérfano                         | candidato canónico              | score  | rule",
    );
    console.log("-".repeat(120));
    for (const r of allRows) {
      console.log(
        `${r.teamSlug.padEnd(20)} | ${r.rawPlayer.name.padEnd(32)} | ${r.rosterCandidate.name.padEnd(32)} | ${r.confidence.toFixed(2)}  | ${r.rule}`,
      );
    }
  }

  // Aviso temprano: matches de probabilidad ALTA que NO se han fusionado
  // todavía porque el huérfano precede al roster (suelen ser diminutivos).
  // Estos los fusionaremos en el backfill, pero el auditor los reporta
  // para revisión manual.
  const highProb = allRows.filter((r) => r.confidence >= 0.9);
  if (highProb.length > 0 && maxScore < 0.9) {
    console.log(
      `\nAviso: ${highProb.length} pares con score ≥0.9 ya matcheados por el nuevo matcher pero no fusionados aún (corre el backfill con --apply).`,
    );
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
