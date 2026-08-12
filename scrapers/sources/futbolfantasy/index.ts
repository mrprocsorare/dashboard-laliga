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
import { futbolfantasyConfig } from "./config";
import { parseMatchIndex, parseMatchPage } from "./parser";

const logger = createLogger("futbolfantasy");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scraper de FutbolFantasy.
 *
 * Flujo:
 *  1. GET /laliga/posibles-alineaciones → extrae la jornada actual y los
 *     10 partidos de LaLiga (sección `proxjornada`).
 *  2. Para cada partido, GET /partidos/{id}-{local}-{visitante} y parsea el
 *     once probable de ambos equipos (probabilidad, portero) y los módulos de
 *     lesionados/sancionados.
 *  3. Cada equipo se procesa de forma aislada: si falla un partido se loguea
 *     y se continúa con los demás.
 */
export class FutbolFantasyScraper implements Scraper {
  readonly id = futbolfantasyConfig.sourceId;

  async scrape(ctx: ScraperContext): Promise<ScraperResult> {
    const client = createHttpClient(futbolfantasyConfig.baseUrl);
    const fetchedAt = new Date();

    // 1) Índice: jornada actual + partidos de LaLiga.
    let matches: Awaited<ReturnType<typeof parseMatchIndex>>;
    try {
      const indexHtml = await fetchHtml(client, futbolfantasyConfig.indexPath, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      matches = parseMatchIndex(indexHtml);
      logger.info(`Jornada: ${matches.length} partidos de LaLiga detectados.`);
    } catch (err) {
      throw new SourceDownError(
        `No se pudo cargar el índice: ${err instanceof Error ? err.message : err}`,
        err,
      );
    }

    // 2) Páginas de partido, secuencial y amable con la fuente.
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
        const blocks = parseMatchPage(pageHtml, match.local, match.visitante);

        for (const [side, teamSlug] of [
          ["local", match.local],
          ["visitante", match.visitante],
        ] as const) {
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

      await sleep(futbolfantasyConfig.requestDelayMs);
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

export default FutbolFantasyScraper;
