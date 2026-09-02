import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import type { Logger } from "../scrapers/logger";
import {
  aliasVariantsFor,
  canonicalizeName,
  isSameLastNameReference,
  normalizeName,
  significantTokens,
} from "./player-names";

type Db = NodePgDatabase<typeof schema>;

/** Vista en memoria de un jugador del roster para el reconciliador. */
type Item = { id: string; rawName: string; canon: string };

/**
 * Reconciliador de duplicados en la tabla `players`.
 *
 * Recorre todos los equipos y, dentro de cada uno, busca jugadores que
 * claramente representan a la misma persona física y los fusiona en uno solo.
 *
 * Reglas de fusión (TODAS conservadoras; ante la duda se conserva el orden
 * del roster y se deja el duplicado en paz):
 *
 *  A. Alias canónico curado: si dos nombres del mismo equipo resuelven al
 *     mismo canónico en `PLAYER_ALIASES` (p. ej. "Lookman" y
 *     "Ademola Lookman"), se fusionan en el canónico.
 *
 *  B. Apellido único en el equipo: si un jugador tiene un solo token y ese
 *     token coincide con el primer o último token de OTRO jugador multi-token
 *     del mismo equipo, y NO hay un tercer jugador con ese apellido, se asume
 *     que es la misma persona y se fusiona. Esto cubre los casos en los que
 *     una fuente empezó publicando solo el apellido antes de que existiera
 *     la entrada canónica.
 *
 *  C. Igualdad exacta normalizada: dos entradas con el mismo `normalizeName`
 *     (p. ej. una con tilde y otra sin) se fusionan en la más completa.
 *
 * La fusión es DESTRUCTIVA pero segura:
 *  - Se elige el jugador canónico como "ganador" (el que tenga el nombre más
 *    completo o el que ya estaba en `PLAYER_ALIASES`).
 *  - Se mueven todas las filas de `latest_player_forecast`, `player_events` y
 *    `player_consensus` del duplicado al ganador.
 *  - Se borra la fila duplicada.
 *  - Todo va en UNA transacción por equipo: o se fusiona todo o nada.
 *  - Es IDEMPOTENTE: si se ejecuta dos veces, la segunda no hace nada porque
 *    los duplicados ya no existen.
 */
export async function reconcilePlayers(
  pool: Pool,
  logger: Logger,
): Promise<{ teams: number; merged: number }> {
  const db = drizzle(pool, { schema }) as Db;

  let teamsProcessed = 0;
  let totalMerged = 0;

  const teams = await db
    .select({ id: schema.teams.id, slug: schema.teams.slug })
    .from(schema.teams);

  for (const team of teams) {
    const mergedHere = await db.transaction(async (tx) => {
      return reconcileTeam(tx, team.id);
    });
    if (mergedHere > 0) {
      logger.info(
        `[reconcile] Equipo ${team.slug}: ${mergedHere} duplicado(s) fusionado(s).`,
      );
      totalMerged += mergedHere;
    }
    teamsProcessed += 1;
  }

  logger.info(
    `Reconciliación finalizada: ${totalMerged} duplicado(s) fusionado(s) en ${teamsProcessed} equipo(s).`,
  );
  return { teams: teamsProcessed, merged: totalMerged };
}

/**
 * Union-Find (Disjoint Set Union) sobre los IDs de jugador. Garantiza que
 * las fusiones transitivas (A↔B, B↔C → un solo cluster A∪B∪C) acaben siempre
 * bajo un único representante, evitando dobles clusters y actualizaciones
 * sobre filas ya borradas.
 */
class UnionFind {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let cur = id;
    while (this.parent.get(cur) !== cur) {
      const p = this.parent.get(cur)!;
      const pp = this.parent.get(p)!;
      this.parent.set(cur, pp);
      cur = pp;
    }
    return cur;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  /** Devuelve los clusters como Map<representante, Set<miembros>>. */
  clusters(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const id of this.parent.keys()) {
      const r = this.find(id);
      const set = out.get(r) ?? new Set<string>();
      set.add(id);
      out.set(r, set);
    }
    return out;
  }
}

/** Fusiona duplicados de un único equipo. Devuelve el número de fusiones. */
async function reconcileTeam(tx: Db, teamId: string): Promise<number> {
  const rows = await tx
    .select({
      id: schema.players.id,
      name: schema.players.name,
    })
    .from(schema.players)
    .where(eq(schema.players.teamId, teamId));

  if (rows.length < 2) return 0;

  const items: Item[] = rows.map((r) => ({
    id: r.id,
    rawName: r.name,
    canon: canonicalizeName(r.name),
  }));
  const byId = new Map(items.map((i) => [i.id, i]));

  const uf = new UnionFind();
  for (const i of items) uf.add(i.id);

  const unionIfSame = (a: Item, b: Item): boolean => {
    if (a.id === b.id) return false;
    if (sameByCanonicalAlias(a, b)) return true;
    if (sameByNormalizedEquality(a, b)) return true;
    // isSameLastNameReference exige (1 token, ≥2 tokens): probamos en ambas
    // direcciones para cubrir los dos órdenes posibles en el roster.
    if (isSameLastNameReference(a.rawName, b.rawName, items.map((i) => i.rawName))) return true;
    if (isSameLastNameReference(b.rawName, a.rawName, items.map((i) => i.rawName))) return true;
    return false;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (uf.find(a.id) === uf.find(b.id)) continue;
      if (unionIfSame(a, b)) uf.union(a.id, b.id);
    }
  }

  // Construimos los clusters y elegimos un líder por cluster: el item con
  // nombre más completo (más tokens significativos; a igualdad, mayor longitud
  // normalizada).
  let mergedCount = 0;
  for (const cluster of uf.clusters().values()) {
    if (cluster.size < 2) continue;
    const members = [...cluster].map((id) => byId.get(id)!).filter(Boolean);
    const leader = pickLeader(members);
    const followers = members.filter((m) => m.id !== leader.id).map((m) => m.id);
    await mergeInto(tx, leader.id, followers);
    mergedCount += followers.length;
  }

  return mergedCount;
}

/** Elige el ganador dentro de un cluster: el de nombre más completo. */
function pickLeader(members: { id: string; rawName: string }[]): {
  id: string;
  rawName: string;
} {
  let best = members[0];
  for (let i = 1; i < members.length; i++) {
    const cur = members[i];
    const bestTokens = significantTokens(best.rawName).length;
    const curTokens = significantTokens(cur.rawName).length;
    if (curTokens > bestTokens) best = cur;
    else if (
      curTokens === bestTokens &&
      normalizeName(cur.rawName).length > normalizeName(best.rawName).length
    ) {
      best = cur;
    }
  }
  return best;
}

/** ¿Dos jugadores son variantes del mismo alias canónico curado? */
function sameByCanonicalAlias(a: Item, b: Item): boolean {
  const canonA = normalizeName(a.canon);
  const canonB = normalizeName(b.canon);
  if (canonA && canonB && canonA === canonB) return true;
  // Si uno de ellos ES el canónico de una variante conocida del otro, también
  // los consideramos el mismo jugador (p. ej. "Ademola Lookman" y "Lookman",
  // donde "Lookman" tiene alias "Ademola Lookman" y ya está canónico).
  const variantsA = aliasVariantsFor(a.canon);
  if (variantsA.has(normalizeName(b.rawName))) return true;
  const variantsB = aliasVariantsFor(b.canon);
  if (variantsB.has(normalizeName(a.rawName))) return true;
  return false;
}

/** ¿Dos jugadores tienen exactamente el mismo nombre normalizado? */
function sameByNormalizedEquality(a: Item, b: Item): boolean {
  const na = normalizeName(a.rawName);
  const nb = normalizeName(b.rawName);
  return Boolean(na) && na === nb;
}

/**
 * Mueve todas las referencias al jugador `followerId` hacia `leaderId` y
 * borra al follower. Maneja el conflicto de PK de `latest_player_forecast`
 * (un follower puede tener una fila `(player_id, source_id)` que ya existe
 * en el líder): en ese caso gana la fila con `fetched_at` más reciente.
 */
async function mergeInto(tx: Db, leaderId: string, followerIds: string[]): Promise<void> {
  if (!followerIds.length) return;

  // 1) latest_player_forecast: para cada (player_id, source_id) del follower
  //    que NO exista ya en el líder, lo movemos. Si YA existe en el líder,
  //    comparamos fetched_at y conservamos el más reciente. La PK es compuesta
  //    (playerId, sourceId), así que identificamos cada fila del follower por
  //    esa pareja.
  for (const followerId of followerIds) {
    const followerForecasts = await tx
      .select()
      .from(schema.latestPlayerForecast)
      .where(eq(schema.latestPlayerForecast.playerId, followerId));

    for (const f of followerForecasts) {
      const leaderExisting = await tx
        .select()
        .from(schema.latestPlayerForecast)
        .where(
          and(
            eq(schema.latestPlayerForecast.playerId, leaderId),
            eq(schema.latestPlayerForecast.sourceId, f.sourceId),
          ),
        )
        .limit(1);

      if (!leaderExisting.length) {
        await tx
          .update(schema.latestPlayerForecast)
          .set({ playerId: leaderId })
          .where(
            and(
              eq(schema.latestPlayerForecast.playerId, followerId),
              eq(schema.latestPlayerForecast.sourceId, f.sourceId),
            ),
          );
      } else {
        const leader = leaderExisting[0];
        const leaderIsNewer = leader.fetchedAt >= f.fetchedAt;
        if (leaderIsNewer) {
          await tx
            .delete(schema.latestPlayerForecast)
            .where(
              and(
                eq(schema.latestPlayerForecast.playerId, followerId),
                eq(schema.latestPlayerForecast.sourceId, f.sourceId),
              ),
            );
        } else {
          await tx
            .update(schema.latestPlayerForecast)
            .set({
              probabilityPct: f.probabilityPct,
              isCertain: f.isCertain,
              forecastType: f.forecastType,
              note: f.note,
              fetchedAt: f.fetchedAt,
            })
            .where(
              and(
                eq(schema.latestPlayerForecast.playerId, leaderId),
                eq(schema.latestPlayerForecast.sourceId, f.sourceId),
              ),
            );
          await tx
            .delete(schema.latestPlayerForecast)
            .where(
              and(
                eq(schema.latestPlayerForecast.playerId, followerId),
                eq(schema.latestPlayerForecast.sourceId, f.sourceId),
              ),
            );
        }
      }
    }
  }

  // 2) player_events: append-only. Movemos TODOS los eventos del follower al
  //    líder; los eventos nunca se borran (filosofía del proyecto).
  await tx
    .update(schema.playerEvents)
    .set({ playerId: leaderId })
    .where(inArray(schema.playerEvents.playerId, followerIds));

  // 3) player_consensus: si el follower tiene fila de consenso, la movemos al
  //    líder. Si el líder ya tiene, descartamos la del follower (el consenso
  //    se regenerará al final del ciclo, así que da igual cuál quede: lo
  //    importante es no duplicar).
  for (const followerId of followerIds) {
    const followerConsensus = await tx
      .select()
      .from(schema.playerConsensus)
      .where(eq(schema.playerConsensus.playerId, followerId))
      .limit(1);

    if (!followerConsensus.length) continue;

    const leaderExisting = await tx
      .select()
      .from(schema.playerConsensus)
      .where(eq(schema.playerConsensus.playerId, leaderId))
      .limit(1);

    if (!leaderExisting.length) {
      await tx
        .update(schema.playerConsensus)
        .set({ playerId: leaderId })
        .where(eq(schema.playerConsensus.playerId, followerId));
    } else {
      await tx
        .delete(schema.playerConsensus)
        .where(eq(schema.playerConsensus.playerId, followerId));
    }
  }

  // 4) player_source_ids (Sorare + genérico): mover al líder si no existe
  //    ya la misma (sourceId, externalSlug/externalPlayerId). Evita violar
  //    índices parciales/únicos.
  for (const followerId of followerIds) {
    const followerMappings = await tx
      .select()
      .from(schema.playerSourceIds)
      .where(eq(schema.playerSourceIds.playerId, followerId));
    for (const m of followerMappings) {
      const exists = await tx
        .select()
        .from(schema.playerSourceIds)
        .where(and(eq(schema.playerSourceIds.playerId, leaderId), eq(schema.playerSourceIds.sourceId, m.sourceId)))
        .limit(1);
      if (!exists.length) {
        await tx
          .update(schema.playerSourceIds)
          .set({ playerId: leaderId })
          .where(and(eq(schema.playerSourceIds.playerId, followerId), eq(schema.playerSourceIds.sourceId, m.sourceId)));
      } else {
        await tx
          .delete(schema.playerSourceIds)
          .where(and(eq(schema.playerSourceIds.playerId, followerId), eq(schema.playerSourceIds.sourceId, m.sourceId)));
      }
    }
  }

  // 5) sorare_player_mappings legacy: igual
  for (const followerId of followerIds) {
    const f = await tx.select().from(schema.sorarePlayerMappings).where(eq(schema.sorarePlayerMappings.playerId, followerId)).limit(1);
    if (!f.length) continue;
    const exists = await tx.select().from(schema.sorarePlayerMappings).where(eq(schema.sorarePlayerMappings.playerId, leaderId)).limit(1);
    if (!exists.length) {
      await tx.update(schema.sorarePlayerMappings).set({ playerId: leaderId }).where(eq(schema.sorarePlayerMappings.playerId, followerId));
    } else {
      await tx.delete(schema.sorarePlayerMappings).where(eq(schema.sorarePlayerMappings.playerId, followerId));
    }
  }

  // 6) unmatched_forecasts: re-asignar resolved_player_id
  await tx.update(schema.unmatchedForecasts).set({ resolvedPlayerId: leaderId }).where(inArray(schema.unmatchedForecasts.resolvedPlayerId, followerIds));

  // 7) Por último, borramos las filas duplicadas de `players`.
  await tx
    .delete(schema.players)
    .where(inArray(schema.players.id, followerIds));
}
