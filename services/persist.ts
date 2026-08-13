import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import type { Logger } from "../scrapers/logger";
import type { ScraperResult, TeamScrapeResult } from "../scrapers/types";
import { isSamePlayer, isSameLastNameReference } from "./player-names";

type Db = NodePgDatabase<typeof schema>;

/** Jugador del equipo cargado en memoria para unificar nombres entre fuentes. */
interface RosterEntry {
  id: string;
  name: string;
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

  // Índice en memoria de los jugadores del equipo: permite unificar nombres
  // entre fuentes sin repetir consultas por cada jugador.
  const roster = await loadRoster(tx, teamId);

  for (const forecast of team.players) {
    const playerId = await resolvePlayer(tx, teamId, roster, forecast);
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
    const playerId = await resolvePlayer(tx, teamId, roster, {
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

/** Carga los jugadores actuales del equipo para unificar nombres en memoria. */
async function loadRoster(tx: Db, teamId: string): Promise<RosterEntry[]> {
  const rows = await tx
    .select({
      id: schema.players.id,
      name: schema.players.name,
      position: schema.players.position,
      photoUrl: schema.players.photoUrl,
    })
    .from(schema.players)
    .where(eq(schema.players.teamId, teamId));

  const all = rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    photoUrl: r.photoUrl,
  }));

  // Deduplicamos el roster en memoria: si un jugador aparece SOLO por su
  // apellido ("Ede") y existe OTRO con nombre completo que termina en ese
  // mismo apellido y NO hay otros multi-token con ese apellido (hermanos),
  // descartamos la versión corta. Así evitamos que un forecast entrante por
  // el apellido solo cree un duplicado cuando ya está el nombre completo.
  const lastToken = (s: string) => {
    const norm = s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, "");
    const tokens = norm.split(/\s+/).filter(Boolean);
    return tokens[tokens.length - 1] ?? "";
  };
  const skip = new Set<string>();
  for (const a of all) {
    if (a.name.split(/\s+/).filter(Boolean).length !== 1) continue;
    const last = lastToken(a.name);
    if (!last) continue;
    const multiWithLast = all.filter(
      (b) =>
        b.id !== a.id &&
        b.name.split(/\s+/).filter(Boolean).length >= 2 &&
        lastToken(b.name) === last,
    );
    if (multiWithLast.length === 1) skip.add(a.id);
  }
  return all.filter((p) => !skip.has(p.id));
}

/**
 * Resuelve el jugador al que corresponde una predicción, unificando nombres
 * entre fuentes. Orden: coincidencia exacta → match conservador por tokens →
 * inserción nueva. Devuelve el player id o null.
 */
async function resolvePlayer(
  tx: Db,
  teamId: string,
  roster: RosterEntry[],
  forecast: { playerName: string; position?: string | null; photoUrl?: string },
): Promise<string | null> {
  const incoming = forecast.playerName.trim();
  if (!incoming) return null;

  // 1) Coincidencia exacta.
  let entry = roster.find((p) => p.name === incoming);

  // 2) Match conservador por tokens (misma persona, distinta grafía).
  if (!entry) {
    entry = roster.find((p) => isSamePlayer(p.name, incoming));
  }

  // 3) Referencia por apellido: el scraper usa solo el apellido ("Balde") y
  //    la única persona del equipo con ese apellido es la que buscamos.
  if (!entry) {
    const rosterNames = roster.map((r) => r.name);
    entry = roster.find((p) =>
      isSameLastNameReference(incoming, p.name, rosterNames),
    );
  }

  if (entry) {
    await enrichPlayer(tx, entry, forecast);
    return entry.id;
  }

  // 3) Jugador nuevo. `onConflictDoNothing` lo hace idempotente ante carreras
  //    (p. ej. dos ciclos de scraping concurrentes contra la misma BD): si otro
  //    proceso ya insertó este jugador, no fallamos; lo recuperamos con un SELECT.
  const inserted = await tx
    .insert(schema.players)
    .values({
      teamId,
      name: incoming,
      position: normalizePosition(forecast.position),
      photoUrl: forecast.photoUrl ?? null,
    })
    .onConflictDoNothing({ target: [schema.players.teamId, schema.players.name] })
    .returning({ id: schema.players.id });

  let id = inserted[0]?.id ?? null;
  if (!id) {
    const existing = await tx
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(and(eq(schema.players.teamId, teamId), eq(schema.players.name, incoming)))
      .limit(1);
    id = existing[0]?.id ?? null;
  }

  if (id) {
    roster.push({
      id,
      name: incoming,
      position: normalizePosition(forecast.position),
      photoUrl: forecast.photoUrl ?? null,
    });
  }
  return id;
}

/**
 * Actualiza el jugador ya existente con datos no vacíos de la fuente (posición,
 * foto). No renombramos el jugador: la identidad ya quedó resuelta por el
 * match fuzzy y el nombre canónico lo aporta la primera fuente que lo creó.
 * Así evitamos cualquier colisión con la restricción única (team_id, name).
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