import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

type Snapshot = {
  createdAt: string;
  playerIds: string[];
  tables: Record<string, Array<Record<string, unknown>>>;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

async function main() {
  const snapshotPath = process.argv.includes("--snapshot")
    ? process.argv[process.argv.indexOf("--snapshot") + 1]
    : undefined;
  const apply = process.argv.includes("--apply");
  if (!snapshotPath) throw new Error("Usa --snapshot <player-merge-before.json>");

  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(`Snapshot creado: ${snapshot.createdAt}`);
  console.log(`Jugadores afectados: ${snapshot.playerIds.length}`);
  for (const [table, rows] of Object.entries(snapshot.tables)) console.log(`${table}: ${rows.length} fila(s)`);

  if (!apply) {
    console.log("\n(dry-run) No se ha modificado Supabase. Para restaurar: añade --apply.");
    await client.end();
    return;
  }

  try {
    await client.query("BEGIN");
    const ids = snapshot.playerIds;
    await client.query("delete from latest_player_forecast where player_id = any($1::uuid[])", [ids]);
    await client.query("delete from player_events where player_id = any($1::uuid[])", [ids]);
    await client.query("delete from player_consensus where player_id = any($1::uuid[])", [ids]);
    await client.query("delete from unmatched_forecasts where resolved_player_id = any($1::uuid[])", [ids]);

    await upsertRows(client, "players", snapshot.tables.players ?? []);
    await insertRows(client, "latest_player_forecast", snapshot.tables.latest_player_forecast ?? []);
    await insertRows(client, "player_events", snapshot.tables.player_events ?? []);
    await insertRows(client, "player_consensus", snapshot.tables.player_consensus ?? []);
    await insertRows(client, "unmatched_forecasts", snapshot.tables.unmatched_forecasts ?? []);
    await client.query("COMMIT");
    console.log("[apply] Snapshot restaurado.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function upsertRows(client: Client, table: string, rows: Array<Record<string, unknown>>): Promise<void> {
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((column) => row[column]);
    const updates = columns.filter((column) => column !== "id");
    const sql = `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
      values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
      on conflict ("id") do update set ${updates.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(", ")}`;
    await client.query(sql, values);
  }
}

async function insertRows(client: Client, table: string, rows: Array<Record<string, unknown>>): Promise<void> {
  for (const row of rows) {
    const columns = Object.keys(row);
    await client.query(
      `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
       values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
      columns.map((column) => row[column]),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
