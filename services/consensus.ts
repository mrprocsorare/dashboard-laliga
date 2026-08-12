import "dotenv/config";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import type { Logger } from "../scrapers/logger";

type Db = NodePgDatabase<typeof schema>;

/**
 * Umbral a partir del cual una fuente "considera titular" a un jugador.
 * Se usa para el campo `sources_starter` del consenso.
 */
export const STARTER_THRESHOLD = 60;

/** Detalle por fuente que se conserva en `agreement` (nunca se ocultan discrepancias). */
interface AgreementEntry {
  source: string;
  probability: number;
  fetched_at: string;
}

/**
 * Motor de consenso.
 *
 * Lee las tablas single-source (latest_player_forecast, latest_team_info,
 * latest_set_pieces) y materializa una vista unificada en player_consensus y
 * team_consensus. Es IDEMPOTENTE y barato (pocas consultas), pensado para
 * ejecutarse tras cada ciclo de scraping sin riesgo de sobrecarga.
 *
 * Reglas:
 *  - La probabilidad de consenso es la MEDIA PONDERADA por `reliability_weight`
 *    de cada fuente (todas pesan 1 por defecto → media simple).
 *  - `sources_starter` cuenta las fuentes con probabilidad >= STARTER_THRESHOLD.
 *  - `agreement` guarda el detalle por fuente para auditar discrepancias.
 *  - Solo se hace UPSERT de lo que hay; nunca se borran filas (filosofía de no
 *    sobrescribir datos válidos con vacío).
 *  - Todo va en UNA transacción: o se materializa todo o no se toca nada.
 */
export async function rebuildConsensus(
  pool: Pool,
  logger: Logger,
): Promise<{ players: number; teams: number }> {
  const db = drizzle(pool, { schema }) as Db;
  const now = new Date();

  let playersWritten = 0;
  let teamsWritten = 0;

  await db.transaction(async (tx) => {
    playersWritten = await rebuildPlayerConsensus(tx, now);
    teamsWritten = await rebuildTeamConsensus(tx, now);
  });

  logger.info(
    `Consenso materializado: ${playersWritten} jugadores, ${teamsWritten} equipos.`,
  );
  return { players: playersWritten, teams: teamsWritten };
}

/** Media ponderada de las predicciones por jugador → player_consensus. */
async function rebuildPlayerConsensus(tx: Db, now: Date): Promise<number> {
  // Predicciones con el peso de fiabilidad de cada fuente.
  const forecasts = await tx
    .select({
      playerId: schema.latestPlayerForecast.playerId,
      probabilityPct: schema.latestPlayerForecast.probabilityPct,
      fetchedAt: schema.latestPlayerForecast.fetchedAt,
      sourceSlug: schema.sources.slug,
      weight: schema.sources.reliabilityWeight,
    })
    .from(schema.latestPlayerForecast)
    .innerJoin(
      schema.sources,
      eq(schema.latestPlayerForecast.sourceId, schema.sources.id),
    );

  if (!forecasts.length) return 0;

  // Agrupamos por jugador.
  const byPlayer = new Map<
    string,
    { probability: number; weight: number; source: string; fetchedAt: Date }[]
  >();
  for (const f of forecasts) {
    const list = byPlayer.get(f.playerId) ?? [];
    list.push({
      probability: f.probabilityPct,
      weight: parseWeight(f.weight),
      source: f.sourceSlug,
      fetchedAt: f.fetchedAt,
    });
    byPlayer.set(f.playerId, list);
  }

  let written = 0;
  for (const [playerId, entries] of byPlayer) {
    let weightedSum = 0;
    let totalWeight = 0;
    let starters = 0;
    const agreement: AgreementEntry[] = [];

    for (const e of entries) {
      weightedSum += e.probability * e.weight;
      totalWeight += e.weight;
      if (e.probability >= STARTER_THRESHOLD) starters += 1;
      agreement.push({
        source: e.source,
        probability: e.probability,
        fetched_at: e.fetchedAt.toISOString(),
      });
    }

    // Ordenamos el detalle por probabilidad descendente para legibilidad.
    agreement.sort((a, b) => b.probability - a.probability);

    const probabilityPct =
      totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    await tx
      .insert(schema.playerConsensus)
      .values({
        playerId,
        probabilityPct,
        sourcesTotal: entries.length,
        sourcesConsideringStarter: starters,
        agreement,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.playerConsensus.playerId],
        set: {
          probabilityPct,
          sourcesTotal: entries.length,
          sourcesConsideringStarter: starters,
          agreement,
          updatedAt: now,
        },
      });
    written += 1;
  }

  return written;
}

/** Formación/entrenador/balón parado por equipo → team_consensus. */
async function rebuildTeamConsensus(tx: Db, now: Date): Promise<number> {
  const teams = await tx.select({ id: schema.teams.id }).from(schema.teams);
  if (!teams.length) return 0;

  // Info de equipo por fuente (coach, formación, noticias).
  const infos = await tx
    .select({
      teamId: schema.latestTeamInfo.teamId,
      coach: schema.latestTeamInfo.coach,
      formation: schema.latestTeamInfo.formation,
      fetchedAt: schema.latestTeamInfo.fetchedAt,
    })
    .from(schema.latestTeamInfo);

  // Balón parado por fuente.
  const pieces = await tx
    .select({
      teamId: schema.latestSetPieces.teamId,
      penaltyTakers: schema.latestSetPieces.penaltyTakers,
      cornerTakers: schema.latestSetPieces.cornerTakers,
      freeKickTakers: schema.latestSetPieces.freeKickTakers,
      fetchedAt: schema.latestSetPieces.fetchedAt,
    })
    .from(schema.latestSetPieces);

  const infosByTeam = groupByTeam(infos);
  const piecesByTeam = groupByTeam(pieces);

  let written = 0;
  for (const team of teams) {
    const teamInfos = (infosByTeam.get(team.id) ?? []).sort(byMostRecent);
    const teamPieces = (piecesByTeam.get(team.id) ?? []).sort(byMostRecent);

    const coach = firstNonNull(teamInfos.map((i) => i.coach));
    const formation = firstNonNull(teamInfos.map((i) => i.formation));

    const setPieces = {
      penalty: firstNonEmpty(teamPieces.map((p) => p.penaltyTakers)),
      corner: firstNonEmpty(teamPieces.map((p) => p.cornerTakers)),
      free_kick: firstNonEmpty(teamPieces.map((p) => p.freeKickTakers)),
    };
    const hasAnyPiece =
      setPieces.penalty.length > 0 ||
      setPieces.corner.length > 0 ||
      setPieces.free_kick.length > 0;

    await tx
      .insert(schema.teamConsensus)
      .values({
        teamId: team.id,
        formation,
        coach,
        setPieces: hasAnyPiece ? setPieces : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.teamConsensus.teamId],
        set: {
          formation,
          coach,
          setPieces: hasAnyPiece ? setPieces : null,
          updatedAt: now,
        },
      });
    written += 1;
  }

  return written;
}

/** Agrupa filas por teamId. */
function groupByTeam<T extends { teamId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.teamId) ?? [];
    list.push(row);
    map.set(row.teamId, list);
  }
  return map;
}

/** Ordena por fetchedAt descendente (más reciente primero). */
function byMostRecent(a: { fetchedAt: Date }, b: { fetchedAt: Date }): number {
  return b.fetchedAt.getTime() - a.fetchedAt.getTime();
}

/** Primer valor no nulo/no vacío de la lista, o null. */
function firstNonNull(values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (v && v.trim().length > 0) return v;
  }
  return null;
}

/** Primer array no vacío de la lista, o []. */
function firstNonEmpty(values: (string[] | null | undefined)[]): string[] {
  for (const v of values) {
    if (Array.isArray(v) && v.length > 0) return v;
  }
  return [];
}

/** Convierte el peso de fiabilidad (texto) a número, con fallback 1. */
function parseWeight(raw: string | null | undefined): number {
  const n = Number.parseFloat(raw ?? "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}
