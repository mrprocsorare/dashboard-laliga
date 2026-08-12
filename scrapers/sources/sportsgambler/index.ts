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
  Position,
} from "../../types";
import { sportsGamblerConfig } from "./config";
import { parseLineupIndex, parseLineupFragment, parseInjuries } from "./parser";

const logger = createLogger("sportsgambler");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scraper de SportsGambler.
 *
 * Flujo:
 *  1. GET /lineups/football/spain-la-liga/ → partidos de LaLiga con once
 *     predicho publicado (los que tienen id de lineups).
 *  2. Para cada partido, GET fragmento AJAX lineups-load2.php?id={id} y parsea
 *     el once de home (local) y away (visitante).
 *  3. GET /injuries/football/spain-la-liga/ y asigna eventos a los equipos
 *     procesados.
 *  Cada partido se procesa de forma aislada. SG no publica % de titularidad:
 *  los jugadores del once predicho se tratan como conjunto (probabilidad 100).
 */
export class SportsGamblerScraper implements Scraper {
  readonly id = sportsGamblerConfig.sourceId;

  async scrape(ctx: ScraperContext): Promise<ScraperResult> {
    const client = createHttpClient(sportsGamblerConfig.baseUrl);
    const fetchedAt = new Date();

    // 1) Índice de lineups.
    let matches: Awaited<ReturnType<typeof parseLineupIndex>>;
    try {
      const indexHtml = await fetchHtml(client, sportsGamblerConfig.lineupsIndexPath, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      matches = parseLineupIndex(indexHtml);
      logger.info(`${matches.length} partidos con once predicho.`);
    } catch (err) {
      throw new SourceDownError(
        `No se pudo cargar el índice de lineups: ${err instanceof Error ? err.message : err}`,
        err,
      );
    }

    // 2) Fragmentos AJAX por partido.
    const teams: TeamScrapeResult[] = [];
    const seenTeams = new Set<string>();
    let failures = 0;

    for (const match of matches) {
      ctx.onProgress?.(`Procesando lineups ${match.local} vs ${match.visitante}…`);
      try {
        const ajaxHtml = await fetchHtml(
          client,
          `${sportsGamblerConfig.lineupsAjaxPath}?id=${match.matchId}`,
          { encoding: "utf-8", timeoutMs: 25_000 },
        );
        const { local, visitante } = parseLineupFragment(ajaxHtml);

        for (const [side, block] of [
          ["local", local],
          ["visitante", visitante],
        ] as const) {
          const teamSlug = side === "local" ? match.local : match.visitante;
          if (seenTeams.has(teamSlug)) continue;
          seenTeams.add(teamSlug);

          const players: PlayerForecast[] = block.players.map((p) => ({
            playerName: p.name,
            probabilityPct: p.probabilityPct,
            isCertain: true,
            position: (p.position as Position | null) ?? undefined,
          }));

          teams.push({ teamSlug, players, events: [] });
          logger.info(`[${teamSlug}] ${players.length} jugadores.`);
        }
      } catch (err) {
        failures += 1;
        logger.errorWithCause(
          `Lineups ${match.local} vs ${match.visitante} falló (se conserva el dato anterior).`,
          err,
        );
      }

      await sleep(sportsGamblerConfig.requestDelayMs);
    }

    if (teams.length === 0) {
      throw new EmptyScrapeError("Ningún equipo devolvió datos en esta ejecución.");
    }

    // 3) Eventos (lesiones/sanciones) por equipo procesado.
    try {
      const injHtml = await fetchHtml(client, sportsGamblerConfig.injuriesPath, {
        encoding: "utf-8",
        timeoutMs: 25_000,
      });
      const injByTeam = parseInjuries(injHtml);
      for (const team of teams) {
        const events = injByTeam.get(team.teamSlug) ?? [];
        team.events = events.map(
          (e): PlayerEvent => ({
            playerName: e.playerName,
            eventType: e.eventType,
            severity: e.severity,
            reason: e.reason ?? undefined,
            note: e.note ?? undefined,
          }),
        );
      }
      logger.info("Eventos de lesiones/sanciones asignados.");
    } catch (err) {
      logger.errorWithCause("No se pudieron cargar lesiones/sanciones (se continúa sin ellas).", err);
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

export default SportsGamblerScraper;
