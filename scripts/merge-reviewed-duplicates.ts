import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, PoolClient } from "pg";

const PLAYER_REFERENCES = [
  { table: "latest_player_forecast", column: "player_id", deleteRule: "CASCADE" },
  { table: "player_events", column: "player_id", deleteRule: "CASCADE" },
  { table: "player_consensus", column: "player_id", deleteRule: "CASCADE" },
  { table: "unmatched_forecasts", column: "resolved_player_id", deleteRule: "SET NULL" },
] as const;

const BACKUP_TABLES = [
  "players",
  "latest_player_forecast",
  "player_events",
  "player_consensus",
  "unmatched_forecasts",
] as const;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function readCsv(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const columns = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
}

interface Pair {
  team: string;
  idA: string;
  nameA: string;
  slugA: string;
  idB: string;
  nameB: string;
  slugB: string;
  decision: string;
  finalSlug: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshotOnly = process.argv.includes("--snapshot-only");
  const input = process.argv.includes("--input")
    ? process.argv[process.argv.indexOf("--input") + 1]
    : "sorare-duplicate-audit-reviewed.csv";
  const backupDir = process.argv.includes("--backup-dir")
    ? process.argv[process.argv.indexOf("--backup-dir") + 1]
    : undefined;
  const rows = readCsv(input);
  const pairs: Pair[] = rows
    .filter((row) => ["MERGE_CONFIRMED", "MERGE_LIKELY"].includes(row.claude_decision?.trim()))
    .map((row) => ({
      team: row.team,
      idA: row.player_id_1,
      nameA: row.player_name_1,
      slugA: row.sorare_slug_1,
      idB: row.player_id_2,
      nameB: row.player_name_2,
      slugB: row.sorare_slug_2,
      decision: row.claude_decision,
      finalSlug: row.claude_final_slug ?? "",
    }));

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString: url });
  await assertPlayerReferences(pool);

  const players = (await pool.query(
    "select p.id::text as id, p.name, p.sorare_slug, t.name as team from players p join teams t on t.id=p.team_id",
  )).rows as Array<{ id: string; name: string; sorare_slug: string | null; team: string }>;
  const byId = new Map(players.map((p) => [p.id, p]));

  const fcRes = await pool.query(
    "select player_id::text as player_id, count(*)::int as n from latest_player_forecast group by player_id",
  );
  const forecastCount = new Map<string, number>();
  for (const r of fcRes.rows) forecastCount.set(r.player_id, r.n);

  const plan: Array<{ leaderId: string; leaderName: string; followerId: string; followerName: string; finalSlug: string; decision: string }> = [];
  for (const pair of pairs) {
    const a = byId.get(pair.idA);
    const b = byId.get(pair.idB);
    if (!a || !b) {
      console.log(`[warn] player_id no encontrado en BD para par: ${pair.nameA} / ${pair.nameB}`);
      continue;
    }
    // Líder: más forecasts; empate: nombre más completo.
    const fa = forecastCount.get(a.id) ?? 0;
    const fb = forecastCount.get(b.id) ?? 0;
    const [leader, follower] = fa === fb
      ? (a.name.length >= b.name.length ? [a, b] : [b, a])
      : fa > fb ? [a, b] : [b, a];
    plan.push({
      leaderId: leader.id,
      leaderName: leader.name,
      followerId: follower.id,
      followerName: follower.name,
      finalSlug: pair.finalSlug,
      decision: pair.decision,
    });
  }

  console.log(apply ? `[apply] Fusionando ${plan.length} par(es)...` : `[dry-run] Plan de fusión: ${plan.length} par(es). No se escribe nada.\n`);
  for (const p of plan) {
    console.log(`LIDER ${p.leaderName} (${p.leaderId}) | FOLLOWER ${p.followerName} (${p.followerId}) | finalSlug=${p.finalSlug || "(sin slug)"} [${p.decision}]`);
  }

  if (!apply) {
    if (snapshotOnly) {
      if (!backupDir) {
        await pool.end();
        throw new Error("--snapshot-only requiere --backup-dir <ruta>.");
      }
      await createBackup(pool, backupDir, plan);
    }
    console.log("\n(dry-run) Para aplicar: npx tsx scripts/merge-reviewed-duplicates.ts --apply --backup-dir <ruta>");
    await pool.end();
    return;
  }

  if (!backupDir) {
    await pool.end();
    throw new Error(
      "Por seguridad, --apply requiere --backup-dir <ruta>. El backup se crea antes de abrir la transaccion.",
    );
  }
  await createBackup(pool, backupDir, plan);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of plan) {
      await mergeOne(client, p.leaderId, p.followerId, p.finalSlug);
    }
    await client.query("COMMIT");
    console.log("[apply] Fusión completada.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
}

async function assertPlayerReferences(pool: Pool): Promise<void> {
  const result = await pool.query<{
    table_name: string;
    column_name: string;
    delete_rule: string;
  }>(`
    SELECT tc.table_name, kcu.column_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'players'
    ORDER BY tc.table_name, kcu.column_name
  `);
  const actual = result.rows
    .map((row) => `${row.table_name}.${row.column_name}:${row.delete_rule}`)
    .sort();
  const expected = PLAYER_REFERENCES
    .map((reference) => `${reference.table}.${reference.column}:${reference.deleteRule}`)
    .sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(
      `Referencias a players no contempladas por este merge. Detectadas: ${actual.join(", ")}. Esperadas: ${expected.join(", ")}`,
    );
  }
}

async function createBackup(
  pool: Pool,
  backupDir: string,
  plan: Array<{ leaderId: string; followerId: string }>,
): Promise<void> {
  mkdirSync(backupDir, { recursive: true });
  const playerIds = [...new Set(plan.flatMap((pair) => [pair.leaderId, pair.followerId]))];
  const snapshot = {
    createdAt: new Date().toISOString(),
    playerIds,
    tables: {
      players: (await pool.query("select * from players where id = any($1::uuid[])", [playerIds])).rows,
      latest_player_forecast: (await pool.query(
        "select * from latest_player_forecast where player_id = any($1::uuid[])",
        [playerIds],
      )).rows,
      player_events: (await pool.query(
        "select * from player_events where player_id = any($1::uuid[])",
        [playerIds],
      )).rows,
      player_consensus: (await pool.query(
        "select * from player_consensus where player_id = any($1::uuid[])",
        [playerIds],
      )).rows,
      unmatched_forecasts: (await pool.query(
        "select * from unmatched_forecasts where resolved_player_id = any($1::uuid[])",
        [playerIds],
      )).rows,
    },
  };
  const snapshotPath = join(backupDir, "player-merge-before.json");
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  writeFileSync(
    join(backupDir, "player-merge-backup-manifest.txt"),
    [
      `created_at=${snapshot.createdAt}`,
      `snapshot=${snapshotPath}`,
      `player_ids=${playerIds.length}`,
      `tables=${BACKUP_TABLES.join(",")}`,
      "scope=all rows involving the merge player ids",
    ].join("\n") + "\n",
    "utf8",
  );
  console.log(`[backup] Snapshot creado: ${snapshotPath}`);
}

async function mergeOne(client: PoolClient, leaderId: string, followerId: string, finalSlug: string): Promise<void> {
  if (finalSlug) {
    await client.query(
      "update players set sorare_slug = $1 where id = $2",
      [finalSlug, leaderId],
    );
  }

  const rows = await client.query<{
    id_dummy: number; source_id: string; probability_pct: number;
    is_certain: boolean; forecast_type: string; note: string | null; fetched_at: Date;
  }>(
    `SELECT source_id::text, probability_pct, is_certain, forecast_type, note, fetched_at
     FROM latest_player_forecast WHERE player_id = $1::uuid`,
    [followerId],
  );
  for (const r of rows.rows) {
    const existing = await client.query(
      `SELECT 1 FROM latest_player_forecast WHERE player_id = $1::uuid AND source_id = $2::uuid`,
      [leaderId, r.source_id],
    );
    if (existing.rowCount === 0) {
      await client.query(
        `UPDATE latest_player_forecast SET player_id = $1::uuid
         WHERE player_id = $2::uuid AND source_id = $3::uuid`,
        [leaderId, followerId, r.source_id],
      );
    } else {
      const leaderRow = await client.query<{ fetched_at: Date }>(
        `SELECT fetched_at FROM latest_player_forecast
         WHERE player_id = $1::uuid AND source_id = $2::uuid`,
        [leaderId, r.source_id],
      );
      const leaderNewer = leaderRow.rows[0].fetched_at >= r.fetched_at;
      if (leaderNewer) {
        await client.query(
          `DELETE FROM latest_player_forecast WHERE player_id = $1::uuid AND source_id = $2::uuid`,
          [followerId, r.source_id],
        );
      } else {
        await client.query(
          `UPDATE latest_player_forecast
           SET probability_pct = $3, is_certain = $4, forecast_type = $5, note = $6, fetched_at = $7
           WHERE player_id = $1::uuid AND source_id = $2::uuid`,
          [leaderId, r.source_id, r.probability_pct, r.is_certain, r.forecast_type, r.note, r.fetched_at],
        );
        await client.query(
          `DELETE FROM latest_player_forecast WHERE player_id = $1::uuid AND source_id = $2::uuid`,
          [followerId, r.source_id],
        );
      }
    }
  }

  await client.query(
    `UPDATE player_events SET player_id = $1::uuid WHERE player_id = $2::uuid`,
    [leaderId, followerId],
  );

  await client.query(
    `UPDATE unmatched_forecasts SET resolved_player_id = $1::uuid WHERE resolved_player_id = $2::uuid`,
    [leaderId, followerId],
  );

  const exists = await client.query(
    `SELECT 1 FROM player_consensus WHERE player_id = $1::uuid`,
    [followerId],
  );
  if (exists.rowCount) {
    const leaderHas = await client.query(
      `SELECT 1 FROM player_consensus WHERE player_id = $1::uuid`,
      [leaderId],
    );
    if (!leaderHas.rowCount) {
      await client.query(
        `UPDATE player_consensus SET player_id = $1::uuid WHERE player_id = $2::uuid`,
        [leaderId, followerId],
      );
    } else {
      await client.query(
        `DELETE FROM player_consensus WHERE player_id = $1::uuid`,
        [followerId],
      );
    }
  }

  await client.query(
    `DELETE FROM players WHERE id = $1::uuid`,
    [followerId],
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
