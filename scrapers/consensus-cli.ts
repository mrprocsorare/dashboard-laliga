import "dotenv/config";
import { Pool } from "pg";
import { rebuildConsensus } from "../services/consensus";
import { createLogger } from "./logger";

const log = createLogger("consensus-cli");

/**
 * CLI para rematerializar el consenso bajo demanda:
 *   npx tsx scrapers/consensus-cli.ts
 *
 * En condiciones normales el consenso ya se ejecuta automáticamente al final de
 * cada ciclo de scraping (ver orchestrator). Este comando existe para poder
 * forzarlo manualmente sin relanzar los scrapers.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log.error("Falta DATABASE_URL en el entorno.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const startedAt = Date.now();
  try {
    await rebuildConsensus(pool, log);
  } finally {
    await pool.end();
  }
  log.info(`Consenso completado en ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  log.errorWithCause("Error fatal rematerializando el consenso.", err);
  process.exit(1);
});
