import "dotenv/config";

import { eq, and } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import { SorareApiClient, computePlayerPrices } from "../lib/sorare-client";
import { SORARE_PRICES_TTL_MS } from "../lib/sorare-sync-policy";

/**
 * Refresco enfocado de PRECIOS (Classic e In-Season) para todos los jugadores
 * ya matcheados con Sorare. No toca el emparejamiento ni las puntuaciones:
 * solo vuelca el suelo de mercado actualizado usando la lógica de mínimo entre
 * fuentes (`priceFromSorareCard`), corrigiendo valores obsoletos/inflados.
 *
 * Es rápido (una sola pasada de `getPlayers`) y se usa tras cambios en la
 * lógica de precios o para forzar una actualización sin re-ejecutar el matching.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("[dry-run] usa --apply para persistir los precios en sorare_player_cache");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const sourceId = (
    await db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.slug, "sorare"))
      .limit(1)
  )[0]?.id;
  if (!sourceId) throw new Error("Fuente 'sorare' no encontrada");

  const mappings = await db
    .select({ slug: schema.playerSourceIds.externalSlug })
    .from(schema.playerSourceIds)
    .where(and(eq(schema.playerSourceIds.sourceId, sourceId), eq(schema.playerSourceIds.status, "matched")));
  const slugs = [...new Set(mappings.map((m) => m.slug).filter((s): s is string => Boolean(s)))];
  console.log(`Refrescando precios para ${slugs.length} slugs matcheados (${apply ? "apply" : "dry-run"}).`);

  const client = new SorareApiClient({ budget: Number(process.env.SORARE_REQUEST_BUDGET ?? 300), requestsPerMinute: 30, minIntervalMs: 2000 });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SORARE_PRICES_TTL_MS);
  let updated = 0;
  let failed = 0;

  for (let index = 0; index < slugs.length; index += 20) {
    const batch = slugs.slice(index, index + 20);
    let players;
    try {
      players = await client.getPlayers(batch);
    } catch (error) {
      console.warn(`[refresh] lote ${index} falló: ${error instanceof Error ? error.message : String(error)}`);
      failed += batch.length;
      continue;
    }
    for (const player of players) {
      const prices = await computePlayerPrices(player, client, player.displayName ?? player.slug);
      const classic = prices.classic.eurCents;
      const inSeason = prices.inSeason.eurCents;
      if (!apply) {
        console.log(
          `${player.slug}: classic=${classic === null ? "-" : (classic / 100).toFixed(2) + "€"} inSeason=${inSeason === null ? "-" : (inSeason / 100).toFixed(2) + "€"}`,
        );
        continue;
      }
      try {
        const existing = await db
          .select()
          .from(schema.sorarePlayerCache)
          .where(eq(schema.sorarePlayerCache.sorareSlug, player.slug))
          .limit(1);
        const old = existing[0];
        await db
          .insert(schema.sorarePlayerCache)
          .values({
            sorareSlug: player.slug,
            displayName: player.displayName,
            firstName: player.firstName,
            lastName: player.lastName,
            birthDay: player.birthDay,
            nationality: player.nationality,
            activeClubName: player.activeClubName,
            activeClubSlug: player.activeClubSlug,
            scores: old?.scores ?? [],
            averageScore: old?.averageScore ?? null,
            latestScore: old?.latestScore ?? null,
            scoresUpdatedAt: old?.scoresUpdatedAt ?? now,
            scoresExpiresAt: old?.scoresExpiresAt ?? now,
            classicPriceEurCents: classic,
            classicCardSlug: prices.classic.slug,
            classicUpdatedAt: now,
            classicExpiresAt: expiresAt,
            inSeasonPriceEurCents: inSeason,
            inSeasonCardSlug: prices.inSeason.slug,
            inSeasonUpdatedAt: now,
            inSeasonExpiresAt: expiresAt,
            lastError: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.sorarePlayerCache.sorareSlug,
            set: {
              displayName: player.displayName,
              firstName: player.firstName,
              lastName: player.lastName,
              birthDay: player.birthDay,
              nationality: player.nationality,
              activeClubName: player.activeClubName,
              activeClubSlug: player.activeClubSlug,
              classicPriceEurCents: classic,
              classicCardSlug: prices.classic.slug,
              classicUpdatedAt: now,
              classicExpiresAt: expiresAt,
              inSeasonPriceEurCents: inSeason,
              inSeasonCardSlug: prices.inSeason.slug,
              inSeasonUpdatedAt: now,
              inSeasonExpiresAt: expiresAt,
              lastError: null,
              updatedAt: now,
            },
          });
        updated++;
      } catch (error) {
        failed++;
        console.warn(`[refresh] ${player.slug} no persistido: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`[refresh] lote ${index} procesado (acumulado: ${updated} actualizados, ${failed} fallidos)`);
  }

  console.log(`FIN: ${updated} actualizados, ${failed} fallidos. Peticiones Sorare: ${client.callsUsed}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
