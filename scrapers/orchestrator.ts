import "dotenv/config";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { persistScraperResult } from "../services/persist";
import { rebuildConsensus } from "../services/consensus";
import { reconcilePlayers } from "../services/reconcile";
import { createLogger } from "./logger";
import type { Scraper, ScraperContext } from "./types";

const log = createLogger("orchestrator");

type Db = NodePgDatabase<typeof schema>;

/**
 * Coordina la ejecución de todos los scrapers registrados.
 *
 * Propiedades clave (requisitos de robustez):
 *  - Independencia total: cada fuente se ejecuta en su propio try/catch. Si una
 *    cae, las demás siguen.
 *  - Auditoría: cada ejecución queda en `scrape_runs` (running → success/partial/failed).
 *  - Regla de oro: si el resultado llega VACÍO, se marca el error y se conservan
 *    los datos anteriores (nunca se sobrescribe con vacío).
 *  - Consenso: al final del ciclo, si al menos una fuente aportó datos, se
 *    rematerializa el consenso. Un fallo del consenso NUNCA hace fallar el
 *    ciclo (se loguea y se conserva el consenso anterior).
 */
export async function orchestrate(
  pool: Pool,
  scrapers: Scraper[],
  opts: { verbose?: boolean; skipConsensus?: boolean } = {},
): Promise<void> {
  const db = drizzle(pool, { schema }) as Db;
  let succeededSources = 0;

  for (const scraper of scrapers) {
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.slug, scraper.id))
      .limit(1);

    if (!source.length) {
      log.warn(
        `No existe la fuente "${scraper.id}" en la tabla sources. Se omite.`,
      );
      continue;
    }
    if (!source[0].enabled) {
      log.info(`Fuente "${scraper.id}" deshabilitada. Se omite.`);
      continue;
    }
    const sourceRow = source[0];

    const ctx: ScraperContext = {
      source: { id: sourceRow.id, name: sourceRow.name, baseUrl: sourceRow.baseUrl },
      verbose: opts.verbose,
      onProgress: (m) => {
        if (opts.verbose) log.info(m);
      },
    };

    const runId = (
      await db
        .insert(schema.scrapeRuns)
        .values({ sourceId: sourceRow.id, status: "running", itemsProcessed: 0 })
        .returning({ id: schema.scrapeRuns.id })
    )[0].id;

    try {
      const result = await scraper.scrape(ctx);

      if (result.teams.length === 0) {
        throw new Error(
          "Resultado vacío: no se persiste nada para no sobrescribir datos válidos.",
        );
      }

      const { teamsProcessed, playersProcessed } = await persistScraperResult(
        result,
        sourceRow.id,
        createLogger(scraper.id),
        pool,
      );

      await db
        .update(schema.scrapeRuns)
        .set({
          status: result.partial ? "partial" : "success",
          itemsProcessed: playersProcessed,
          finishedAt: new Date(),
          errorMessage: result.partial
            ? "Completado con fallos aislados (se conservaron datos anteriores)."
            : null,
        })
        .where(eq(schema.scrapeRuns.id, runId));

      succeededSources += 1;
      log.info(
        `[${scraper.id}] run ${result.partial ? "PARCIAL" : "OK"} · ${teamsProcessed} equipos · ${playersProcessed} jugadores.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.scrapeRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: message,
        })
        .where(eq(schema.scrapeRuns.id, runId));

      log.errorWithCause(`Fuente "${scraper.id}" falló. Se conservan los datos anteriores.`, err);
    }
  }

  // Consenso: solo si al menos una fuente aportó datos este ciclo (evita gasto
  // innecesario cuando todo falló). Un error de consenso nunca hace fallar el
  // ciclo: se loguea y se conserva el consenso anterior.
  if (!opts.skipConsensus && succeededSources > 0) {
    // Reconciliación de duplicados: detectamos y fusionamos jugadores que
    // representan a la misma persona física (p. ej. "Lookman" vs
    // "Ademola Lookman"). Se ejecuta antes del consenso para que el rebuild
    // opere ya sobre el roster limpio. Es idempotente y barato; un fallo aquí
    // NO bloquea el consenso (se conserva el estado anterior).
    try {
      await reconcilePlayers(pool, createLogger("reconcile"));
    } catch (err) {
      log.errorWithCause(
        "La reconciliación de duplicados falló. Se conserva el roster anterior.",
        err,
      );
    }

    try {
      await rebuildConsensus(pool, createLogger("consensus"));
    } catch (err) {
      log.errorWithCause(
        "El consenso falló. Se conserva el consenso anterior (los scrapers no se ven afectados).",
        err,
      );
    }
  } else if (opts.skipConsensus) {
    log.info("Consenso omitido (skipConsensus).");
  } else {
    log.info("Ninguna fuente aportó datos este ciclo; se omite el consenso.");
  }
}