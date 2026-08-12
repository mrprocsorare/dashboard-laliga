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
import { jornadaPerfectaConfig } from "./config";
import { parseMatchIndex, parseMatchPage } from "./parser";

const logger = createLogger("jornadaperfecta");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scraper de Jornada Perfecta.
 *
 * Flujo:
 *  1. GET /onces-posibles/ → extrae los partidos de la jornada actual.
 *  2. Para cada partido, GET /partido/{id}-{slugs} (server-side) y parsea el
 *     once probable de ambos equipos (posición por línea del campo, % por
 *     percent-budget) y los no disponibles (dudas/lesiones/sanciones).
 *  3. Cada partido se procesa de forma aislada.
 */
export class JornadaPerfectaScraper implements Scraper {
  readonly id = jornadaPerfectaConfig.sourceId;

  async scrape(ctx: ScraperContext): Promise<ScraperResult> {
    const client = createHttpClient(jornadaPerfectaConfig.baseUrl);
    const fetchedAt = new Date();

    // 1) Índice.
    let matches: Awaited<ReturnType<typeof parseMatchIndex>>;
    try {
      const indexHtml = await fetchHtml(client, jornadaPerfectaConfig.indexTemplate, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      matches = parseMatchIndex(indexHtml);
      logger.info(`${matches.length} partidos de LaLiga en la jornada.`);
    } catch (err) {
      throw new SourceDownError(
        `No se pudo cargar la homepage: ${err instanceof Error ? err.message : err}`,
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
          const teamSlug = side === "local" ? match.local : match.visitante;
          if (seenTeams.has(teamSlug)) continue;
          seenTeams.add(teamSlug);

          const block = blocks[side];

          const players: PlayerForecast[] = block.players.map((p) => ({
            playerName: p.name,
            probabilityPct: p.probabilityPct,
            isCertain: p.probabilityPct >= 90,
            position: p.position ?? undefined,
            photoUrl: p.photoUrl ?? undefined,
          }));

          const events: PlayerEvent[] = block.events.map((e) => ({
            playerName: e.playerName,
            eventType: e.eventType,
            severity: e.severity,
            reason: e.reason ?? undefined,
            note: e.note ?? undefined,
          }));

          teams.push({ teamSlug, players, events });
          logger.info(`[${teamSlug}] ${players.length} jugadores, ${events.length} eventos.`);
        }
      } catch (err) {
        failures += 1;
        logger.errorWithCause(
          `Partido ${match.local} vs ${match.visitante} falló (se conserva el dato anterior).`,
          err,
        );
      }

      await sleep(jornadaPerfectaConfig.requestDelayMs);
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

export default JornadaPerfectaScraper;
