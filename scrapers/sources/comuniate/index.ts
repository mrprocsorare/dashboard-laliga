import { createLogger } from "../../logger";
import { fetchHtml, postForm, createHttpClient } from "../../http";
import { SourceDownError, EmptyScrapeError } from "../../errors";
import type {
  Scraper,
  ScraperContext,
  ScraperResult,
  TeamScrapeResult,
  PlayerEvent,
} from "../../types";
import { comuniateConfig, COMMONIATE_TEAM_IDS } from "./config";
import { parseFixtureIndex, parseLineup } from "./parser";

const logger = createLogger("comuniate");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scraper de Comuniate (canary del framework).
 *
 * Flujo:
 *  1. GET /alineaciones/comunio → extrae la jornada actual.
 *  2. Para cada equipo conocido, POST /ajax/pintar_alineacion.php para obtener
 *     el once probable (HTML parseable).
 *  3. Cada equipo se procesa de forma aislada: si uno falla, se loguea, se
 *     conserva el último dato válido y se continúa con los demás.
 */
export class ComuniateScraper implements Scraper {
  readonly id = comuniateConfig.sourceId;

  async scrape(ctx: ScraperContext): Promise<ScraperResult> {
    const client = createHttpClient(comuniateConfig.baseUrl);
    const fetchedAt = new Date();

    // 1) Índice de jornada.
    let jornada: number;
    try {
      const indexHtml = await fetchHtml(client, comuniateConfig.indexPath, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      const parsed = parseFixtureIndex(indexHtml);
      jornada = parsed.jornada;
      logger.info(`Jornada detectada: ${jornada}`);
    } catch (err) {
      throw new SourceDownError(
        `No se pudo cargar el índice de jornada: ${err instanceof Error ? err.message : err}`,
        err,
      );
    }

    // 2) Onces por equipo, secuencial y amable con la fuente.
    const teams: TeamScrapeResult[] = [];
    let failures = 0;

    for (const teamId of COMMONIATE_TEAM_IDS) {
      const teamSlug = comuniateConfig.teamIdToSlug[teamId as keyof typeof comuniateConfig.teamIdToSlug];
      if (!teamSlug) continue;

      ctx.onProgress?.(`Procesando ${teamSlug} (comuniate id ${teamId})…`);
      try {
        const lineupHtml = await postForm(client, comuniateConfig.ajaxLineupPath, {
          tipo: "posible",
          inicio: 1,
          id_jornada: jornada,
          id_equipo: teamId,
          modo: "clasico",
        }, {
          encoding: "windows-1252",
          timeoutMs: 25_000,
        });

        const lineup = parseLineup(lineupHtml);

        const players = lineup.map((p) => {
          const hasPct = p.probabilityPct !== null;
          return {
            playerName: p.name,
            // Sin etiqueta de % → la fuente lo da en el once → fijo (100).
            probabilityPct: hasPct ? (p.probabilityPct as number) : 100,
            isCertain: !hasPct ? true : (p.probabilityPct as number) >= 90,
            position: p.position,
            photoUrl: p.photoUrl ?? undefined,
            note: p.alternative ? `Alternativa: ${p.alternative}` : undefined,
          };
        });

        const events: PlayerEvent[] = lineup
          .filter((p) => p.doubt || p.injury)
          .map(
            (p): PlayerEvent => ({
              playerName: p.name,
              eventType: p.injury ? "injury" : "doubt",
              severity: p.injury ? "light" : "none",
              note: p.injury
                ? "Llega con molestias o tocado (fuente Comuniate)."
                : p.alternative
                  ? `Duda de titularidad. Alternativa: ${p.alternative}.`
                  : "Muchas dudas sobre la titularidad.",
            }),
          );

        teams.push({ teamSlug, players, events });
        logger.info(`[${teamSlug}] ${players.length} jugadores procesados.`);
      } catch (err) {
        failures += 1;
        logger.errorWithCause(`Equipo ${teamSlug} falló (se conserva el dato anterior).`, err);
      }

      await sleep(comuniateConfig.requestDelayMs);
    }

    if (teams.length === 0) {
      throw new EmptyScrapeError("Ningún equipo devolvió datos en esta ejecución.");
    }

    logger.info(
      `Completado: ${teams.length}/${COMMONIATE_TEAM_IDS.length} equipos (${failures} fallos aislados).`,
    );

    return {
      sourceId: ctx.source.id,
      teams,
      fetchedAt,
      partial: failures > 0,
    };
  }
}

export default ComuniateScraper;