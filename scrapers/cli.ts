import "dotenv/config";
import { Pool } from "pg";
import { orchestrate } from "./orchestrator";
import { getRegisteredScrapers } from "./registry";
import { createLogger } from "./logger";

const log = createLogger("cli");

/**
 * CLI local del pipeline de scraping:
 *   npx tsx scrapers/cli.ts [--only comuniate] [--verbose]
 *
 * En CI (GitHub Actions) se invoca con la misma orden desde el workflow.
 */
async function main() {
  const argv = process.argv.slice(2);
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex >= 0 ? String(argv[onlyIndex + 1]) : undefined;
  const verbose = argv.includes("--verbose") || argv.includes("-v");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log.error("Falta DATABASE_URL en el entorno.");
    process.exit(1);
  }

  let scrapers = getRegisteredScrapers();
  if (only) {
    scrapers = scrapers.filter((s) => s.id === only);
    if (!scrapers.length) {
      log.error(`Scraper desconocido: ${only}`);
      process.exit(1);
    }
  }

  log.info(
    `Iniciando scraping de ${scrapers.length} fuente(s): ${scrapers.map((s) => s.id).join(", ")}`,
  );

  const pool = new Pool({ connectionString });
  const startedAt = Date.now();

  try {
    await orchestrate(pool, scrapers, { verbose });
  } finally {
    await pool.end();
  }

  log.info(`Pipeline finalizado en ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  log.errorWithCause("Error fatal en el pipeline.", err);
  process.exit(1);
});