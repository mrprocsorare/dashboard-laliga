import { createLogger } from "../../logger";
import { fetchHtml, createHttpClient } from "../../http";
import { SourceDownError, EmptyScrapeError } from "../../errors";
import type {
  Scraper,
  ScraperContext,
  ScraperResult,
  TeamScrapeResult,
  PlayerEvent,
  PlayerForecast,
} from "../../types";
import { biwengerConfig } from "./config";
import { parseMatchIndex, parseMatchPage } from "./parser";

const logger = createLogger("biwenger");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scraper de Biwenger (biwenger.as.com).
 *
 * Flujo:
 *  1. GET el índice de la jornada vigente → extrae los partidos publicados.
 *  2. Para cada partido, GET su página y parsea el once probable de ambos
 *     equipos (filas de `div.field.football`) + la sección "No disponibles".
 *  3. Cada partido se procesa de forma aislada: si falla, se conserva el dato
 *     anterior y se continúa.
 */
export class BiwengerScraper implements Scraper {
  readonly id = biwengerConfig.sourceId;

  async scrape(ctx: ScraperContext): Promise<ScraperResult> {
    const client = createHttpClient(biwengerConfig.baseUrl);
    const fetchedAt = new Date();

    // 1) Índice de jornada.
    let matches: Awaited<ReturnType<typeof parseMatchIndex>>;
    try {
      const indexHtml = await fetchHtml(client, biwengerConfig.indexPath, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      matches = parseMatchIndex(indexHtml);
      logger.info(`${matches.length} partidos publicados en la jornada.`);
    } catch (err) {
      throw new SourceDownError(
        `No se pudo cargar el índice de Biwenger: ${err instanceof Error ? err.message : err}`,
        err,
      );
    }

    // 2) Páginas de partido, secuencial y amable.
    const teams: TeamScrapeResult[] = [];
    const seenTeams = new Set<string>();
    let failures = 0;

    for (const match of matches) {
      ctx.onProgress?.(`Procesando partido ${match.local} vs ${match.visitante}…`);
      try {
        const pageHtml = await fetchHtml(client, match.matchUrl, {
          encoding: "utf-8",
          timeoutMs: 25_000,
        });
        const blocks = parseMatchPage(pageHtml);

        for (const side of ["local", "visitante"] as const) {
          const block = blocks[side];
          if (!block || seenTeams.has(block.teamSlug)) continue;
          seenTeams.add(block.teamSlug);

          const players: PlayerForecast[] = block.players.map((p) => ({
            playerName: p.name,
            // Biwenger no publica %: el once publicado se asume titular.
            probabilityPct: 100,
            isCertain: true,
            position: p.position,
            photoUrl: p.photoUrl ?? undefined,
          }));

          const events: PlayerEvent[] = block.events.map((e) => ({
            playerName: e.name,
            eventType: e.eventType,
            severity: e.severity,
            reason: e.reason ?? undefined,
            note: e.note ?? undefined,
          }));

          teams.push({ teamSlug: block.teamSlug, players, events });
          logger.info(
            `[${block.teamSlug}] ${players.length} jugadores, ${events.length} no disponibles.`,
          );
        }
      } catch (err) {
        failures += 1;
        logger.errorWithCause(
          `Partido ${match.local} vs ${match.visitante} falló (se conserva el dato anterior).`,
          err,
        );
      }

      await sleep(biwengerConfig.requestDelayMs);
    }

    if (teams.length === 0) {
      throw new EmptyScrapeError("Ningún equipo devolvió datos en esta ejecución.");
    }

    logger.info(
      `Completado: ${teams.length} equipos, ${matches.length} partidos, ${failures} fallos aislados.`,
    );

    return {
      sourceId: ctx.source.id,
      teams,
      fetchedAt,
      partial: failures > 0,
    };
  }
}

export default BiwengerScraper;