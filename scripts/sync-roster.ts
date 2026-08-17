/**
 * Sincroniza el roster canónico de los 20 equipos desde Wikipedia (vía API
 * oficial de MediaWiki) contra la tabla `players`.
 *
 * Por cada equipo:
 *  1. Descarga el roster actual (nombre completo + posición) de Wikipedia.
 *  2. Para cada jugador del roster:
 *     - Si NO existe fila `players` con `canonical_name` = nombre canónico
 *       para ese equipo → INSERT con `is_canonical_roster = true`.
 *     - Si ya existe → UPDATE `is_canonical_roster = true` (reválida).
 *  3. Jugadores que estaban en el roster pero ya NO están en Wikipedia
 *     → se marcan `is_canonical_roster = false` (no se borran, para no
 *     perder FKs de forecasts previos).
 *
 * Uso:
 *   npx tsx scripts/sync-roster.ts          # dry-run por defecto
 *   npx tsx scripts/sync-roster.ts --apply  # aplica los cambios
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { WIKI_TARGETS, fetchRoster } from "../lib/roster";

interface Plan {
  teamSlug: string;
  inserts: { name: string; pos: string }[];
  reactivates: { id: string; name: string }[];
  deactivates: { id: string; name: string }[];
}

async function computePlan(pool: Pool): Promise<Plan[]> {
  const db = drizzle(pool, { schema });
  const plans: Plan[] = [];

  for (const target of WIKI_TARGETS) {
    let roster;
    try {
      roster = await fetchRoster(target);
    } catch (err) {
      console.warn(
        `[sync-roster] WARN: no se pudo descargar ${target.slug} (${target.wikiPage}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    const teamRow = await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.slug, roster.teamSlug))
      .limit(1);
    if (!teamRow.length) {
      console.warn(`[sync-roster] WARN: equipo desconocido en BD: ${roster.teamSlug}`);
      continue;
    }
    const teamId = teamRow[0].id;

    const existing = await db
      .select({
        id: schema.players.id,
        name: schema.players.name,
        canonicalName: schema.players.canonicalName,
        isCanonicalRoster: schema.players.isCanonicalRoster,
      })
      .from(schema.players)
      .where(eq(schema.players.teamId, teamId));

    const existingByCanon = new Map(
      existing
        .filter((p) => p.canonicalName)
        .map((p) => [p.canonicalName as string, p]),
    );
    // También mapeamos por `name` para detectar jugadores existentes con el
    // nombre completo pero sin `canonical_name` (caso típico: jugadores que
    // ya estaban en BD antes de añadir el roster cerrado).
    const existingByName = new Map(
      existing.map((p) => [p.name, p]),
    );

    const inserts: Plan["inserts"] = [];
    const reactivates: Plan["reactivates"] = [];
    const wikiNames = new Set<string>();

    for (const player of roster.players) {
      wikiNames.add(player.name);
      const foundByCanon = existingByCanon.get(player.name);
      const foundByName = existingByName.get(player.name);
      if (!foundByCanon && !foundByName) {
        // Ni por canonical_name ni por name → INSERT nuevo.
        inserts.push({ name: player.name, pos: player.pos });
      } else {
        const found = foundByCanon ?? foundByName!;
        if (!found.isCanonicalRoster) {
          reactivates.push({ id: found.id, name: found.name });
        }
      }
    }

    const deactivates: Plan["deactivates"] = existing
      .filter((p) => p.isCanonicalRoster && p.canonicalName && !wikiNames.has(p.canonicalName))
      .map((p) => ({ id: p.id, name: p.canonicalName as string }));

    plans.push({
      teamSlug: roster.teamSlug,
      inserts,
      reactivates,
      deactivates,
    });
  }
  return plans;
}

async function applyPlan(pool: Pool, plans: Plan[]): Promise<void> {
  const db = drizzle(pool, { schema });
  await db.transaction(async (tx) => {
    for (const plan of plans) {
      const teamRow = await tx
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.slug, plan.teamSlug))
        .limit(1);
      if (!teamRow.length) continue;
      const teamId = teamRow[0].id;

      for (const ins of plan.inserts) {
        // 1) Si ya existe una fila con (team_id, name) → actualizar canonical_name
        //    y activar is_canonical_roster. Esto preserva los FKs del jugador
        //    (forecasts, events, consensus) y solo lo "promueve" a roster.
        const updatedByName = await tx
          .update(schema.players)
          .set({
            canonicalName: ins.name,
            isCanonicalRoster: true,
            position: ins.pos as "POR" | "DEF" | "MED" | "DEL",
          })
          .where(
            and(eq(schema.players.teamId, teamId), eq(schema.players.name, ins.name)),
          )
          .returning({ id: schema.players.id });
        if (updatedByName.length) continue;

        // 2) Si ya existe una fila con (team_id, canonical_name) → activar
        //    is_canonical_roster (idempotente).
        const updatedByCanon = await tx
          .update(schema.players)
          .set({
            isCanonicalRoster: true,
            position: ins.pos as "POR" | "DEF" | "MED" | "DEL",
          })
          .where(
            and(
              eq(schema.players.teamId, teamId),
              eq(schema.players.canonicalName, ins.name),
            ),
          )
          .returning({ id: schema.players.id });
        if (updatedByCanon.length) continue;

        // 3) INSERT nuevo (no existía ni por name ni por canonical_name).
        await tx.insert(schema.players).values({
          teamId,
          name: ins.name,
          canonicalName: ins.name,
          position: ins.pos as "POR" | "DEF" | "MED" | "DEL",
          isCanonicalRoster: true,
        });
      }
      for (const r of plan.reactivates) {
        await tx
          .update(schema.players)
          .set({
            isCanonicalRoster: true,
            canonicalName: r.name,
          })
          .where(eq(schema.players.id, r.id));
      }
      for (const d of plan.deactivates) {
        await tx
          .update(schema.players)
          .set({ isCanonicalRoster: false })
          .where(eq(schema.players.id, d.id));
      }
    }
  });
}

function printPlan(plans: Plan[]): void {
  let totalInserts = 0;
  let totalReactivates = 0;
  let totalDeactivates = 0;
  for (const p of plans) {
    if (!p.inserts.length && !p.reactivates.length && !p.deactivates.length) continue;
    console.log(`\n[${p.teamSlug}]`);
    if (p.inserts.length) {
      console.log(`  +${p.inserts.length} INSERT:`);
      for (const i of p.inserts) console.log(`     ${i.pos} ${i.name}`);
      totalInserts += p.inserts.length;
    }
    if (p.reactivates.length) {
      console.log(`  ~${p.reactivates.length} REACTIVATE:`);
      for (const r of p.reactivates) console.log(`     ${r.name}`);
      totalReactivates += p.reactivates.length;
    }
    if (p.deactivates.length) {
      console.log(`  -${p.deactivates.length} DEACTIVATE:`);
      for (const d of p.deactivates) console.log(`     ${d.name}`);
      totalDeactivates += p.deactivates.length;
    }
  }
  console.log(
    `\nTotal: ${totalInserts} inserts, ${totalReactivates} reactivates, ${totalDeactivates} deactivates.`,
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });

  console.log(apply ? "[apply] Sincronizando roster desde Wikipedia..." : "[dry-run] Calculando plan...");
  const plan = await computePlan(pool);
  printPlan(plan);

  if (!apply) {
    console.log("\n(dry-run) Para aplicar, ejecuta: npx tsx scripts/sync-roster.ts --apply");
    await pool.end();
    return;
  }

  await applyPlan(pool, plan);
  console.log("[apply] Sincronización completada.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
