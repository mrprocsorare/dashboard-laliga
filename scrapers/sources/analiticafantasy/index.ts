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
import { analiticaConfig } from "./config";
import { parseMatchIndex, parseMatchPage } from "./parser";

const logger = createLogger("analiticafantasy");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scraper de Analítica Fantasy.
 *
 * Flujo:
 *  1. GET la página de la jornada vigente → extrae del JSON-LD el ItemList de
 *     partidos de esa jornada (solo los que ya tienen once publicado).
 *  2. Para cada partido, GET /partido/{id} (SSR) y parsea el once probable de
 *     ambos equipos (columna 0 = local, columna 1 = visitante) + parte médico.
 *  3. Cada partido se procesa de forma aislada: si falla, se conserva el dato
 *     anterior y se continúa.
 */
export class AnaliticaFantasyScraper implements Scraper {
  readonly id = analiticaConfig.sourceId;

  async scrape(ctx: ScraperContext): Promise<ScraperResult> {
    const client = createHttpClient(analiticaConfig.baseUrl);
    const fetchedAt = new Date();

    // 1) Índice: jornada vigente → partidos publicados en el JSON-LD.
    let matches: Awaited<ReturnType<typeof parseMatchIndex>>;
    try {
      const indexHtml = await fetchHtml(client, analiticaConfig.indexTemplate, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      matches = parseMatchIndex(indexHtml);
      logger.info(`${matches.length} partidos publicados en la jornada.`);
    } catch (err) {
      throw new SourceDownError(
        `No se pudo cargar el índice de jornada: ${err instanceof Error ? err.message : err}`,
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

      await sleep(analiticaConfig.requestDelayMs);
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

export default AnaliticaFantasyScraper;
