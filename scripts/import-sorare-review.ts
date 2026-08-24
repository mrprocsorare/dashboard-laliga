import "dotenv/config";

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += char;
  }
  values.push(value);
  return values;
}

async function main() {
  const path = process.argv[2] ?? "sorare-auto-audit-reviewed.csv";
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const columns = parseCsvLine(lines[0] ?? "");
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  let applied = 0;
  for (const row of rows) {
    if (row.claude_decision !== "ACCEPT" || row.sorare_exists !== "yes" || row.club_match !== "yes") continue;
    const slug = row.slug_verificado_nuevo?.trim();
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug)) continue;
    const result = await db
      .update(schema.players)
      .set({ sorareSlug: slug, dateOfBirth: row.sorare_birth_day || null })
      .where(eq(schema.players.id, row.player_id))
      .returning({ id: schema.players.id });
    if (result.length) applied++;
  }
  console.log(`Importados ${applied} slugs aceptados desde ${path}.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
