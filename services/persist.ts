import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import type { Logger } from "../scrapers/logger";
import type { ScraperResult, TeamScrapeResult } from "../scrapers/types";
import { matchAgainstRoster } from "../lib/match";
import { loadRosterFromDb, getRosterForTeam } from "../lib/roster-cache";

type Db = NodePgDatabase<typeof schema>;

/** Jugador del equipo cargado en memoria para unificar nombres entre fuentes. */
interface RosterEntry {
  id: string;
  name: string;
  canonicalName: string | null;
  isCanonicalRoster: boolean;
  position: "POR" | "DEF" | "MED" | "DEL" | null;
  photoUrl: string | null;
}

/**
 * Persiste el resultado de UNA fuente en las tablas single-source.
 *
 * REGLA DE ORO: NUNCA sobrescribir datos buenos por datos vacíos.
 *  - latest_team_info       → merge campo a campo (lo vacío conserva el anterior).
 *  - latest_set_pieces      → solo se pisa un vector si la fuente envía elementos.
 *  - latest_player_forecast → solo se tocan jugadores que la fuente SÍ reporta;
 *                             el resto queda intacto (último dato válido).
 *  - player_events          → append-only (nunca se borran).
 *
 * MATCHING CERRADO CONTRA ROSTER (commit actual):
 *  - Cada nombre entrante se compara SOLO contra el roster canónico del equipo
 *    (lista cerrada de 20-25 jugadores, fuente Wikipedia vía API de MediaWiki).
 *  - Si hay match con confianza suficiente → se reusa el `player_id` del roster.
 *  - Si NO hay match → el forecast se guarda en `unmatched_forecasts` para
 *    revisión manual. Nunca se crea un jugador "huérfano" silenciosamente.
 *  - Esto elimina de raíz el bug de duplicados: el roster es la única fuente
 *    de verdad para los `player_id` de cada equipo.
 */
export async function persistScraperResult(
  result: ScraperResult,
  dbSourceId: string,
  logger: Logger,
  pool: Pool,
): Promise<{ teamsProcessed: number; playersProcessed: number; unmatched: number }> {
  const db = drizzle(pool, { schema }) as Db;
  const now = new Date();

  // Cargamos el roster canónico una sola vez por ciclo de persistencia.
  await loadRosterFromDb(pool);

  let playersProcessed = 0;
  let unmatched = 0;

  await db.transaction(async (tx) => {
    for (const team of result.teams) {
      const r = await persistTeam(tx, team, dbSourceId, now, logger, pool);
      playersProcessed += r.processed;
      unmatched += r.unmatched;
    }
  });

  logger.info(
    `Persistido: ${result.teams.length} equipos, ${playersProcessed} predicciones de jugador, ${unmatched} sin match de roster.`,
  );
  return { teamsProcessed: result.teams.length, playersProcessed, unmatched };
}

async function persistTeam(
  tx: Db,
  team: TeamScrapeResult,
  sourceId: string,
  now: Date,
  logger: Logger,
  pool: Pool,
): Promise<{ processed: number; unmatched: number }> {
  const teamRow = await tx
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, team.teamSlug))
    .limit(1);
  if (!teamRow.length) {
    logger.warn(`Equipo desconocido en catálogo: "${team.teamSlug}". No se persiste.`);
    return { processed: 0, unmatched: 0 };
  }
  const teamId = teamRow[0].id;

  await upsertTeamInfo(tx, team, teamId, sourceId, now);
  await upsertSetPieces(tx, team, teamId, sourceId, now);

  const roster = await loadRoster(tx, teamId);
  const wikiRoster = await getRosterForTeam(pool, team.teamSlug);

  let processed = 0;
  let unmatched = 0;
  const reportedPlayerIds = new Set<string>();

  for (const forecast of team.players) {
    const result = await resolvePlayer(tx, teamId, roster, wikiRoster, forecast, sourceId, now);
    if (result === null) {
      unmatched += 1;
      continue;
    }
    processed += 1;
    reportedPlayerIds.add(result);

    await tx
      .insert(schema.latestPlayerForecast)
      .values({
        playerId: result,
        sourceId,
        probabilityPct: clampProbability(forecast.probabilityPct),
        isCertain: forecast.isCertain ?? false,
        forecastType: forecast.forecastType ?? "probable",
        note: forecast.note ?? null,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.latestPlayerForecast.playerId, schema.latestPlayerForecast.sourceId],
        set: {
          probabilityPct: clampProbability(forecast.probabilityPct),
          isCertain: forecast.isCertain ?? false,
          forecastType: forecast.forecastType ?? "probable",
          note: forecast.note ?? null,
          fetchedAt: now,
        },
      });
  }

  // REGLA DE FRESCO (generalizada): cualquier jugador que esta fuente hubiera
  // pronosticado con anterioridad para ESTE equipo y que NO figura en la
  // alineación recién raspada se pone a 0 (no titular). Cubre tanto al roster
  // canónico como a jugadores no canónicos (p. ej. fichajes que se marcharon):
  // si la fuente ya no los lista, su % obsoleto se resetea en vez de quedar
  // congelado inflando el consenso. Solo se aplica cuando la fuente reportó al
  // menos un jugador, para no borrar datos válidos si el parseo falló y
  // devolvió vacío.
  if (team.players.length > 0) {
    const prevForecastRows = await tx
      .select({ playerId: schema.latestPlayerForecast.playerId })
      .from(schema.latestPlayerForecast)
      .innerJoin(schema.players, eq(schema.latestPlayerForecast.playerId, schema.players.id))
      .where(
        and(
          eq(schema.latestPlayerForecast.sourceId, sourceId),
          eq(schema.players.teamId, teamId),
        ),
      );
    for (const row of prevForecastRows) {
      if (reportedPlayerIds.has(row.playerId)) continue;
      await tx
        .insert(schema.latestPlayerForecast)
        .values({
          playerId: row.playerId,
          sourceId,
          probabilityPct: 0,
          isCertain: false,
          forecastType: "probable",
          note: "No aparece en la alineación probable de la fuente",
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.latestPlayerForecast.playerId, schema.latestPlayerForecast.sourceId],
          set: {
            probabilityPct: 0,
            isCertain: false,
            forecastType: "probable",
            note: "No aparece en la alineación probable de la fuente",
            fetchedAt: now,
          },
        });
    }
  }

  for (const event of team.events) {
    const result = await resolvePlayer(
      tx,
      teamId,
      roster,
      wikiRoster,
      { playerName: event.playerName },
      sourceId,
      now,
    );
    if (result === null) continue;

    await tx.insert(schema.playerEvents).values({
      playerId: result,
      sourceId,
      eventType: event.eventType,
      severity: event.severity ?? "none",
      reason: event.reason ?? null,
      expectedReturn: event.expectedReturn ?? null,
      note: event.note ?? null,
      recordedAt: now,
    });
  }

  return { processed, unmatched };
}

/** Merge campo a campo: lo vacío conserva el valor anterior almacenado. */
async function upsertTeamInfo(
  tx: Db,
  team: TeamScrapeResult,
  teamId: string,
  sourceId: string,
  now: Date,
): Promise<void> {
  const info = team.info ?? {};
  const prev = (
    await tx
      .select()
      .from(schema.latestTeamInfo)
      .where(and(eq(schema.latestTeamInfo.teamId, teamId), eq(schema.latestTeamInfo.sourceId, sourceId)))
      .limit(1)
  )[0];

  const coach = info.coach ?? prev?.coach ?? null;
  const formation = info.formation ?? prev?.formation ?? null;
  const news = info.news ?? prev?.news ?? null;

  await tx
    .insert(schema.latestTeamInfo)
    .values({ teamId, sourceId, coach, formation, news, fetchedAt: now })
    .onConflictDoUpdate({
      target: [schema.latestTeamInfo.teamId, schema.latestTeamInfo.sourceId],
      set: { coach, formation, news, fetchedAt: now },
    });
}

/** Un vector de lanzadores solo se pisa si la fuente envía elementos nuevos. */
async function upsertSetPieces(
  tx: Db,
  team: TeamScrapeResult,
  teamId: string,
  sourceId: string,
  now: Date,
): Promise<void> {
  const sp = team.setPieces;
  if (!sp) return;

  const prev = (
    await tx
      .select()
      .from(schema.latestSetPieces)
      .where(and(eq(schema.latestSetPieces.teamId, teamId), eq(schema.latestSetPieces.sourceId, sourceId)))
      .limit(1)
  )[0];

  const penalty = sp.penaltyTakers?.length ? sp.penaltyTakers : prev?.penaltyTakers;
  const corner = sp.cornerTakers?.length ? sp.cornerTakers : prev?.cornerTakers;
  const freeKick = sp.freeKickTakers?.length ? sp.freeKickTakers : prev?.freeKickTakers;

  await tx
    .insert(schema.latestSetPieces)
    .values({
      teamId,
      sourceId,
      penaltyTakers: penalty ?? null,
      cornerTakers: corner ?? null,
      freeKickTakers: freeKick ?? null,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.latestSetPieces.teamId, schema.latestSetPieces.sourceId],
      set: {
        penaltyTakers: penalty ?? prev?.penaltyTakers ?? null,
        cornerTakers: corner ?? prev?.cornerTakers ?? null,
        freeKickTakers: freeKick ?? prev?.freeKickTakers ?? null,
        fetchedAt: now,
      },
    });
}

/**
 * Carga los jugadores del roster canónico del equipo (los marcados con
 * `is_canonical_roster = true`). Estos son los únicos que pueden recibir
 * forecasts: el resto del roster queda inactivo.
 */
async function loadRoster(tx: Db, teamId: string): Promise<RosterEntry[]> {
  const rows = await tx
    .select({
      id: schema.players.id,
      name: schema.players.name,
      canonicalName: schema.players.canonicalName,
      isCanonicalRoster: schema.players.isCanonicalRoster,
      position: schema.players.position,
      photoUrl: schema.players.photoUrl,
    })
    .from(schema.players)
    .where(and(eq(schema.players.teamId, teamId), eq(schema.players.isCanonicalRoster, true)));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    canonicalName: r.canonicalName,
    isCanonicalRoster: r.isCanonicalRoster,
    position: r.position,
    photoUrl: r.photoUrl,
  }));
}

/**
 * Resuelve el jugador al que corresponde una predicción, usando el roster
 * canónico cerrado del equipo.
 *
 *  - Si el nombre matchea con suficiente confianza un jugador del roster
 *    cerrado (Wikipedia), se reusa ESE `player_id`. Nunca crea uno nuevo.
 *  - Si NO matchea, devuelve `null` → el caller persiste el forecast en
 *    `unmatched_forecasts` para revisión manual.
 */
async function resolvePlayer(
  tx: Db,
  teamId: string,
  roster: RosterEntry[],
  wikiRoster: { name: string; pos: "POR" | "DEF" | "MED" | "DEL" }[],
  forecast: { playerName: string; position?: string | null; photoUrl?: string },
  sourceId: string,
  now: Date,
): Promise<string | null> {
  const raw = forecast.playerName.trim();
  if (!raw) return null;

  // 1) Matching contra el roster cerrado (Wikipedia).
  // El roster en BD puede tener Nombres Canónicos vacíos si el sync no se ha
  // hecho todavía. Caemos al roster de Wikipedia en memoria como fallback.
  const candidatesFromDb = roster
    .filter((r) => r.canonicalName)
    .map((r) => ({ name: r.canonicalName as string, pos: r.position ?? "MED" }));
  const combined = candidatesFromDb.length > 0 ? candidatesFromDb : wikiRoster;
  const match = matchAgainstRoster(raw, combined);
  if (match) {
    const target = roster.find((r) => (r.canonicalName ?? r.name) === combined[match.index].name);
    if (target) {
      await enrichPlayer(tx, target, forecast);
      return target.id;
    }
    // Si el match apunta a un jugador que solo está en wikiRoster pero aún no
    // se ha sincronizado con la BD (caso muy raro entre sync y scraper),
    // caemos a la creación. En la práctica esto no debería pasar si el sync
    // se ejecuta antes del scrape.
  }

  // 2) Sin match en el roster cerrado → guardar como unmatched para revisión.
  // El parámetro `forecast` es una unión de PlayerForecast | PlayerEvent;
  // aquí tratamos de forma tolerante cualquier campo opcional.
  const f = forecast as {
    probabilityPct?: number | null;
    isCertain?: boolean;
    forecastType?: "probable" | "confirmed";
    note?: string | null;
  };
  await tx.insert(schema.unmatchedForecasts).values({
    teamId,
    sourceId,
    rawName: raw,
    normalizedName: raw,
    probabilityPct:
      typeof f.probabilityPct === "number" ? clampProbability(f.probabilityPct) : null,
    isCertain: f.isCertain ?? false,
    forecastType: f.forecastType ?? "probable",
    note: f.note ?? null,
    fetchedAt: now,
  });
  return null;
}

/**
 * Actualiza el jugador ya existente con datos no vacíos de la fuente (posición,
 * foto). Nunca renombra.
 */
async function enrichPlayer(
  tx: Db,
  entry: RosterEntry,
  forecast: { position?: string | null; photoUrl?: string },
): Promise<void> {
  const patch: Partial<typeof schema.players.$inferInsert> = {};

  const position = normalizePosition(forecast.position);
  if (position && position !== entry.position) {
    patch.position = position;
    entry.position = position;
  }
  if (forecast.photoUrl && forecast.photoUrl !== entry.photoUrl) {
    patch.photoUrl = forecast.photoUrl;
    entry.photoUrl = forecast.photoUrl;
  }

  if (Object.keys(patch).length) {
    await tx
      .update(schema.players)
      .set(patch)
      .where(eq(schema.players.id, entry.id));
  }
}

/** Normaliza una probabilidad a 0-100 entero. */
export function clampProbability(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

const POSITIONS = new Set(["POR", "DEF", "MED", "DEL"]);

/** Valida una posición y la devuelve tipada, o null si no es válida. */
function normalizePosition(
  candidate: string | null | undefined,
): "POR" | "DEF" | "MED" | "DEL" | null {
  return candidate && POSITIONS.has(candidate)
    ? (candidate as "POR" | "DEF" | "MED" | "DEL")
    : null;
}
