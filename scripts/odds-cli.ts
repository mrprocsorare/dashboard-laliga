import "dotenv/config";
import { Pool } from "pg";
import { persistLaLigaOdds } from "../lib/odds";

/**
 * Job independiente de cuotas. Nunca se invoca desde scrapers/cli.ts: un
 * fallo de The Odds API no puede impedir las alineaciones.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString });
  try {
    const result = await persistLaLigaOdds(pool);
    console.log(
      `[odds] ${result.events} partidos recibidos, ${result.withOdds} con cuotas h2h.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[odds] Falló la actualización independiente de cuotas:", error);
  process.exit(1);
});
