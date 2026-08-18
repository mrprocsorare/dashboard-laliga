import "dotenv/config";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { searchSorarePlayers } from "../lib/sorare";
import { players, teams } from "../database/schema";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1]) values.push(args[++index]);
    else if (args[index].startsWith(`${name}=`)) values.push(args[index].slice(name.length + 1));
  }
  return values;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const apply = process.argv.includes("--apply");
  const manualOnly = process.argv.includes("--manual-only");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const rows = await db
    .select({ id: players.id, name: players.name, sorareSlug: players.sorareSlug, teamName: teams.name })
    .from(players)
    .innerJoin(teams, eq(players.teamId, teams.id));

  const manual = optionValues("--set");
  for (const mapping of manual) {
    const separator = mapping.indexOf("=");
    if (separator < 1 || separator === mapping.length - 1) {
      console.log(`Formato invalido para --set: ${mapping}. Usa "Nombre del jugador=slug".`);
      continue;
    }
    const playerRef = mapping.slice(0, separator).trim();
    const slug = mapping.slice(separator + 1).trim();
    const player = rows.find((row) => row.id === playerRef || normalize(row.name) === normalize(playerRef));
    if (!player) {
      console.log(`No encontrado: ${playerRef}`);
      continue;
    }
    console.log(`[manual] ${player.name} (${player.teamName}) -> ${slug}`);
    if (apply) await db.update(players).set({ sorareSlug: slug }).where(eq(players.id, player.id));
    player.sorareSlug = slug;
  }

  if (manualOnly) {
    console.log(apply ? "Mapeos manuales aplicados." : "Dry-run: usa --apply para aplicar los mapeos.");
    await pool.end();
    return;
  }

  const pending = rows.filter((row) => !row.sorareSlug);
  console.log(`Buscando ${pending.length} jugadores sin sorare_slug...`);
  for (let index = 0; index < pending.length; index++) {
    const player = pending[index];
    const candidates = await searchSorarePlayers(player.name);
    const exact = candidates.filter((candidate) => normalize(candidate.displayName) === normalize(player.name));
    if (exact.length === 1) {
      console.log(`[match] ${player.name} (${player.teamName}) -> ${exact[0].slug}`);
      if (apply) await db.update(players).set({ sorareSlug: exact[0].slug }).where(eq(players.id, player.id));
    } else if (candidates.length) {
      console.log(`[review] ${player.name} (${player.teamName}): ${candidates.map((c) => `${c.displayName}=${c.slug}`).join(" | ")}`);
    } else {
      console.log(`[none] ${player.name} (${player.teamName})`);
    }
    if (index < pending.length - 1) await sleep(3_100);
  }

  console.log(apply ? "Mapeo terminado." : "Dry-run terminado: usa --apply para guardar coincidencias exactas.");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
