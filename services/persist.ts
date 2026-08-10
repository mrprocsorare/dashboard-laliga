import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import type { Logger } from "../scrapers/logger";
import type { ScraperResult, TeamScrapeResult } from "../scrapers/types";

type Db = NodePgDatabase<typeof schema>;

/**
 * Persiste el resultado de UNA fuente en las tablas single-source.
 *
 * REGLA DE ORO: NUNCA sobrescribir datos buenos por datos vacíos.
 *  - latest_team_info       → merge campo a campo (lo vacío conserva el anterior).
 *  - latest_set_pieces      → solo se pisa un vector si la fuente envía elementos.
 *  - latest_player_forecast → solo se tocan jugadores que la fuente SÍ reporta;
 *                             el resto queda intacto (último dato válido).
 *  - player_events          → append-only (nunca se borran).
 * Toda la escritura va en UNA transacción por fuente.
 */
export async function persistScraperResult(
  result: ScraperResult,
  dbSourceId: string,
  logger: Logger,
  pool: Pool,
): Promise<{ teamsProcessed: number; playersProcessed: number }> {
  const db = drizzle(pool, { schema }) as Db;
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const team of result.teams) {
      await persistTeam(tx, team, dbSourceId, now, logger);
    }
  });

  let playersProcessed = 0;
  for (const team of result.teams) playersProcessed += team.players.length;

  logger.info(
    `Persistido: ${result.teams.length} equipos, ${playersProcessed} predicciones de jugador.`,
  );
  return { teamsProcessed: result.teams.length, playersProcessed };
}

async function persistTeam(
  tx: Db,
  team: TeamScrapeResult,
  sourceId: string,
  now: Date,
  logger: Logger,
): Promise<void> {
  const teamRow = await tx
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, team.teamSlug))
    .limit(1);
  if (!teamRow.length) {
    logger.warn(
      `Equipo desconocido en catálogo: "${team.teamSlug}". No se persiste.`,
    );
    return;
  }
  const teamId = teamRow[0].id;

  await upsertTeamInfo(tx, team, teamId, sourceId, now);
  await upsertSetPieces(tx, team, teamId, sourceId, now);

  for (const forecast of team.players) {
    const playerId = await upsertPlayer(tx, team.teamSlug, forecast);
    if (!playerId) continue;

    await tx
      .insert(schema.latestPlayerForecast)
      .values({
        playerId,
        sourceId,
        probabilityPct: clampProbability(forecast.probabilityPct),
        isCertain: forecast.isCertain ?? false,
        note: forecast.note ?? null,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.latestPlayerForecast.playerId, schema.latestPlayerForecast.sourceId],
        set: {
          probabilityPct: clampProbability(forecast.probabilityPct),
          isCertain: forecast.isCertain ?? false,
          note: forecast.note ?? null,
          fetchedAt: now,
        },
      });
  }

  for (const event of team.events) {
    const playerId = await upsertPlayer(tx, team.teamSlug, {
      playerName: event.playerName,
    });
    if (!playerId) continue;

    await tx.insert(schema.playerEvents).values({
      playerId,
      sourceId,
      eventType: event.eventType,
      severity: event.severity ?? "none",
      reason: event.reason ?? null,
      expectedReturn: event.expectedReturn ?? null,
      note: event.note ?? null,
      recordedAt: now,
    });
  }
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

/** Crea el jugador si no existe (par único team_id + name). Devuelve su id o null. */
async function upsertPlayer(
  tx: Db,
  teamSlug: string,
  forecast: { playerName: string; position?: string | null; photoUrl?: string },
): Promise<string | null> {
  const teamRow = await tx
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, teamSlug))
    .limit(1);
  if (!teamRow.length) return null;

  const teamId = teamRow[0].id;
  const existing = await tx
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(and(eq(schema.players.teamId, teamId), eq(schema.players.name, forecast.playerName)))
    .limit(1);

  if (existing.length) {
    // Patch condicional: solo se pisa lo que la fuente reporta no vacío.
    const patch: Partial<typeof schema.players.$inferInsert> = {};
    const position = normalizePosition(forecast.position);
    if (position) patch.position = position;
    if (forecast.photoUrl) patch.photoUrl = forecast.photoUrl;
    if (Object.keys(patch).length) {
      await tx
        .update(schema.players)
        .set(patch)
        .where(eq(schema.players.id, existing[0].id));
    }
    return existing[0].id;
  }

  const inserted = await tx
    .insert(schema.players)
    .values({
      teamId,
      name: forecast.playerName,
      position: normalizePosition(forecast.position),
      photoUrl: forecast.photoUrl ?? null,
    })
    .returning({ id: schema.players.id });

  return inserted[0]?.id ?? null;
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