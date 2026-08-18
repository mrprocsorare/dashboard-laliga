import "dotenv/config";
import { Pool } from "pg";

/**
 * Row Level Security: habilita RLS en las 10 tablas del catálogo y concede
 * SOLO SELECT al rol `public` (anon y authenticated).
 *
 * Los escritos los realizan los scrapers con la clave de servicio / usuario
 * postgres, que ignoran RLS. La app (frontend) queda de solo lectura y
 * La aplicación es pública y queda protegida contra escrituras.
 *
 * Idempotente: usa DO $$ para no fallar si ya existe.
 */
const TABLES = [
  "sources",
  "teams",
  "players",
  "scrape_runs",
  "latest_player_forecast",
  "latest_team_info",
  "latest_set_pieces",
  "player_events",
  "player_consensus",
  "team_consensus",
  "match_odds",
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Falta DATABASE_URL. Abortando.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  for (const table of TABLES) {
    await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);

    const policy = `ensure_read_policy_${table.replace(/\W/g, "_")}`;
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = '${policy}'
        ) THEN
          ALTER POLICY ${policy} ON ${table} TO public;
        ELSE
          CREATE POLICY ${policy} ON ${table}
            FOR SELECT TO public USING (true);
        END IF;
      END $$;
    `);
  }

  await pool.end();
  console.log(`RLS configurado en ${TABLES.length} tablas (SELECT público, solo lectura).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
