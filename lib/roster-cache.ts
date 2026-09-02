/**
 * Cache en memoria del roster canónico por equipo, refrescado una vez al mes.
 *
 * En el arranque del proceso (o cuando se actualiza el roster desde
 * `scripts/sync-roster.ts`) se lee la tabla `players` filtrando por
 * `is_canonical_roster = true`. El cache vive en memoria y se invalida si
 * se modifica (p. ej. tras un sync).
 *
 * El cache es la fuente de verdad que consume `services/persist.ts` para
 * resolver nombres scrapeados contra una lista CERRADA de jugadores.
 */
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { WIKI_TARGETS, type CanonicalPlayer } from "./roster";

export type RosterByTeam = Map<string, CanonicalPlayer[]>;

let cache: { rosters: RosterByTeam; loadedAt: Date; maxAgeMs: number } | null = null;

/**
 * Carga el roster canónico de la BD (una query por equipo) y lo guarda en
 * cache. Devuelve también el mapa para uso inmediato.
 */
export async function loadRosterFromDb(
  pool: Pool,
  opts: { maxAgeMs?: number } = {},
): Promise<RosterByTeam> {
  const db = drizzle(pool, { schema });
  const teamRows = await db
    .select({ id: schema.teams.id, slug: schema.teams.slug })
    .from(schema.teams);
  const slugById = new Map(teamRows.map((t) => [t.id, t.slug]));
  const rows = await db
    .select({
      teamId: schema.players.teamId,
      canonicalName: schema.players.canonicalName,
      name: schema.players.name,
      position: schema.players.position,
    })
    .from(schema.players)
    .where(eq(schema.players.isCanonicalRoster, true));

  const byTeam: RosterByTeam = new Map();
  for (const slug of WIKI_TARGETS.map((t) => t.slug)) byTeam.set(slug, []);
  for (const r of rows) {
    const slug = slugById.get(r.teamId);
    if (!slug) continue;
    const list = byTeam.get(slug) ?? [];
    list.push({
      name: r.canonicalName ?? r.name,
      pos: r.position ?? "MED",
    });
    byTeam.set(slug, list);
  }
  cache = { rosters: byTeam, loadedAt: new Date(), maxAgeMs: opts.maxAgeMs ?? 30 * 24 * 3600 * 1000 };
  return byTeam;
}

export function getCachedRoster(): RosterByTeam | null {
  return cache?.rosters ?? null;
}

export function clearRosterCache(): void {
  cache = null;
}

/** True si el cache en memoria tiene menos de `maxAgeMs` ms. */
export function isCacheFresh(maxAgeMs = 30 * 24 * 3600 * 1000): boolean {
  if (!cache) return false;
  return Date.now() - cache.loadedAt.getTime() < maxAgeMs;
}

/**
 * Helper para `services/persist.ts`: devuelve el roster de un equipo,
 * recargándolo desde BD si el cache expiró.
 */
export async function getRosterForTeam(
  pool: Pool,
  teamSlug: string,
): Promise<CanonicalPlayer[]> {
  if (!cache || !isCacheFresh(cache.maxAgeMs)) await loadRosterFromDb(pool);
  if (!cache) return [];
  return cache.rosters.get(teamSlug) ?? [];
}
