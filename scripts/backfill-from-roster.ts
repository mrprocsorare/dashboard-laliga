/**
 * Backfill: dado que ya tenemos el roster canónico (`is_canonical_roster=true`)
 * poblado en la BD, fusiona los jugadores duplicados (los que NO están en
 * roster pero su nombre coincide con el de un jugador del roster cerrado).
 *
 * Reglas:
 *  - Cada duplicado se fusiona con el jugador del roster que matchee por
 *    `matchAgainstRoster` (mismo matcher que usa el scraper en producción).
 *  - Si un duplicado NO matchea con ningún jugador del roster (caso de un
 *    jugador que ya no está en la plantilla y aún no se ha desactivado), se
 *    mantiene como jugador histórico (sin eliminar) para no perder FKs.
 *  - Las FKs (`latest_player_forecast`, `player_events`, `player_consensus`)
 *    se mueven del duplicado al canónico, igual que en
 *    `services/reconcile.ts`.
 *
 * Uso:
 *   npx tsx scripts/backfill-from-roster.ts          # dry-run
 *   npx tsx scripts/backfill-from-roster.ts --apply  # ejecuta la fusión
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../database/schema";
import { matchAgainstRoster } from "../lib/match";
import { loadRosterFromDb } from "../lib/roster-cache";

interface FusionPlan {
  /** Jugador del roster canónico al que se le mueven las FKs. */
  leader: { id: string; name: string; canonicalName: string | null };
  /** Duplicados que se fusionan con el líder. */
  followers: { id: string; name: string; canonicalName: string | null }[];
}

async function computePlan(pool: Pool): Promise<FusionPlan[]> {
  const db = drizzle(pool, { schema });
  await loadRosterFromDb(pool);
  const teams = await db
    .select({ id: schema.teams.id, slug: schema.teams.slug })
    .from(schema.teams);

  const plan: FusionPlan[] = [];

  for (const team of teams) {
    const all = await db
      .select({
        id: schema.players.id,
        name: schema.players.name,
        canonicalName: schema.players.canonicalName,
        isCanonicalRoster: schema.players.isCanonicalRoster,
        position: schema.players.position,
      })
      .from(schema.players)
      .where(eq(schema.players.teamId, team.id));

    const roster = all.filter((p) => p.isCanonicalRoster && p.canonicalName);
    const candidates = roster.map((p) => ({
      name: p.canonicalName as string,
      pos: (p.position ?? "MED") as "POR" | "DEF" | "MED" | "DEL",
    }));

    // Construimos un mapa duplicado → líder. Un duplicado es cualquier fila
    // NO-canónica cuyo nombre matchee contra el roster.
    const dupToLeader = new Map<string, { id: string; name: string; canonicalName: string | null }>();
    for (const p of all) {
      if (p.isCanonicalRoster) continue;
      const m = matchAgainstRoster(p.name, candidates, { minConfidence: 0.6 });
      if (!m) continue;
      const leader = roster[m.index];
      if (!leader) continue;
      // No fusionar un duplicado consigo mismo.
      if (leader.id === p.id) continue;
      dupToLeader.set(p.id, { id: leader.id, name: leader.name, canonicalName: leader.canonicalName });
    }

    // Agrupamos por líder.
    const byLeader = new Map<string, FusionPlan>();
    for (const [dupId, leader] of dupToLeader) {
      const dup = all.find((p) => p.id === dupId)!;
      const existing = byLeader.get(leader.id);
      if (existing) {
        existing.followers.push({ id: dup.id, name: dup.name, canonicalName: dup.canonicalName });
      } else {
        byLeader.set(leader.id, {
          leader,
          followers: [{ id: dup.id, name: dup.name, canonicalName: dup.canonicalName }],
        });
      }
    }
    plan.push(...byLeader.values());
  }
  return plan;
}

async function applyPlan(pool: Pool, plan: FusionPlan[]): Promise<void> {
  const db = drizzle(pool, { schema });
  await db.transaction(async (tx) => {
    for (const p of plan) {
      const leaderId = p.leader.id;
      const followerIds = p.followers.map((f) => f.id);

      // 1) latest_player_forecast: mover al líder.
      for (const fid of followerIds) {
        const rows = await tx
          .select()
          .from(schema.latestPlayerForecast)
          .where(eq(schema.latestPlayerForecast.playerId, fid));
        for (const r of rows) {
          const leaderExisting = await tx
            .select()
            .from(schema.latestPlayerForecast)
            .where(
              and(
                eq(schema.latestPlayerForecast.playerId, leaderId),
                eq(schema.latestPlayerForecast.sourceId, r.sourceId),
              ),
            )
            .limit(1);
          if (!leaderExisting.length) {
            await tx
              .update(schema.latestPlayerForecast)
              .set({ playerId: leaderId })
              .where(
                and(
                  eq(schema.latestPlayerForecast.playerId, fid),
                  eq(schema.latestPlayerForecast.sourceId, r.sourceId),
                ),
              );
          } else {
            const leader = leaderExisting[0];
            if (leader.fetchedAt >= r.fetchedAt) {
              await tx
                .delete(schema.latestPlayerForecast)
                .where(
                  and(
                    eq(schema.latestPlayerForecast.playerId, fid),
                    eq(schema.latestPlayerForecast.sourceId, r.sourceId),
                  ),
                );
            } else {
              await tx
                .update(schema.latestPlayerForecast)
                .set({
                  probabilityPct: r.probabilityPct,
                  isCertain: r.isCertain,
                  forecastType: r.forecastType,
                  note: r.note,
                  fetchedAt: r.fetchedAt,
                })
                .where(
                  and(
                    eq(schema.latestPlayerForecast.playerId, leaderId),
                    eq(schema.latestPlayerForecast.sourceId, r.sourceId),
                  ),
                );
              await tx
                .delete(schema.latestPlayerForecast)
                .where(
                  and(
                    eq(schema.latestPlayerForecast.playerId, fid),
                    eq(schema.latestPlayerForecast.sourceId, r.sourceId),
                  ),
                );
            }
          }
        }
      }

      // 2) player_events: mover al líder.
      await tx
        .update(schema.playerEvents)
        .set({ playerId: leaderId })
        .where(inArray(schema.playerEvents.playerId, followerIds));

      // 3) player_consensus: mover si no existe en el líder.
      for (const fid of followerIds) {
        const exists = await tx
          .select()
          .from(schema.playerConsensus)
          .where(eq(schema.playerConsensus.playerId, fid))
          .limit(1);
        if (!exists.length) continue;
        const leaderExisting = await tx
          .select()
          .from(schema.playerConsensus)
          .where(eq(schema.playerConsensus.playerId, leaderId))
          .limit(1);
        if (!leaderExisting.length) {
          await tx
            .update(schema.playerConsensus)
            .set({ playerId: leaderId })
            .where(eq(schema.playerConsensus.playerId, fid));
        } else {
          await tx
            .delete(schema.playerConsensus)
            .where(eq(schema.playerConsensus.playerId, fid));
        }
      }

      // 4) Borrar duplicados.
      await tx
        .delete(schema.players)
        .where(inArray(schema.players.id, followerIds));
    }
  });
}

function printPlan(plan: FusionPlan[]): void {
  let totalMerged = 0;
  for (const p of plan) {
    console.log(`\n[leader: ${p.leader.canonicalName ?? p.leader.name}] (id=${p.leader.id})`);
    for (const f of p.followers) {
      console.log(`  - dup "${f.name}" (id=${f.id})`);
      totalMerged += 1;
    }
  }
  console.log(`\nTotal duplicados a fusionar: ${totalMerged}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });

  console.log(apply ? "[apply] Calculando plan de fusión..." : "[dry-run] Calculando plan...");
  const plan = await computePlan(pool);
  printPlan(plan);

  if (!apply) {
    console.log("\n(dry-run) Para aplicar, ejecuta: npx tsx scripts/backfill-from-roster.ts --apply");
    await pool.end();
    return;
  }

  await applyPlan(pool, plan);
  console.log("[apply] Backfill completado.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
