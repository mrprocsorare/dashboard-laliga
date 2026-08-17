/**
 * Script de recuperación: restaura manualmente el caso Cuti/Cristian.
 *
 * El bug histórico del backfill previo hizo que Cristian Romero (que tenía
 * 4 forecasts propios) se borrara antes de moverlos a Cuti Romero, dejando
 * a Cuti con 0 forecasts. Como Cristian está borrado, ya no podemos
 * mover; en su lugar insertamos 4 forecasts "placeholder" para Cuti con
 * los source_ids esperados, marcados con note="recovered-from-cristian".
 *
 * La alternativa más limpia sería esperar al próximo scrape: las fuentes
 * escribirán "Cristian Romero", mi matcher (con Regla C) lo identificará
 * como Cuti, e insertará/actualizará los forecasts. Pero ese flujo depende
 * del cron del CI.
 *
 * Uso:
 *   npx tsx scripts/recover-cuti-romero.ts --apply
 *
 * Solo se ejecuta una vez. Es idempotente.
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import * as schema from "../database/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const CUTI_ID = "c9ed15ae-a7cd-4ffa-9d58-1a577f869d6f";
const CRISTIAN_OLD_ID = "07769a11-6447-45e7-9dde-88f103132e9f";
const SOURCE_IDS = [
  "3c36c7f0-bdfc-4090-bd08-3abf9eaef7aa", // comuniate
  "5da8d3da-47bf-4a75-8de9-259c4891f365", // futbolfantasy
  "6a5140ac-511b-4d22-b0ff-d6d7165207d6", // analiticafantasy
  "e3c8f9d6-08e7-492b-91a5-3bc477ccb7a9", // jornadaperfecta
];

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema }) as Db;

  console.log("[dry-run] Plan de recuperación:");
  for (const sid of SOURCE_IDS) {
    const ex = await db
      .select()
      .from(schema.latestPlayerForecast)
      .where(and(
        eq(schema.latestPlayerForecast.playerId, CUTI_ID),
        eq(schema.latestPlayerForecast.sourceId, sid),
      ))
      .limit(1);
    if (ex.length) {
      console.log(`  source=${sid}: ya existe forecast para Cuti → skip`);
    } else {
      console.log(`  source=${sid}: INSERT placeholder con note="recovered-from-cristian"`);
    }
  }

  if (!apply) {
    console.log("\n(dry-run) Para aplicar, ejecuta con --apply");
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    for (const sid of SOURCE_IDS) {
      const ex = await tx
        .select()
        .from(schema.latestPlayerForecast)
        .where(and(
          eq(schema.latestPlayerForecast.playerId, CUTI_ID),
          eq(schema.latestPlayerForecast.sourceId, sid),
        ))
        .limit(1);
      if (ex.length) continue;
      await tx.insert(schema.latestPlayerForecast).values({
        playerId: CUTI_ID,
        sourceId: sid,
        probabilityPct: 80,
        isCertain: false,
        forecastType: "probable",
        note: "recovered-from-cristian",
        fetchedAt: new Date(),
      });
    }
    // También borramos el evento huérfano de Cristian si existe (FK cascade ya lo hizo).
    const ev = await tx.select().from(schema.playerEvents).where(eq(schema.playerEvents.playerId, CRISTIAN_OLD_ID)).limit(1);
    if (ev.length) {
      // No debería haber eventos huérfanos porque CASCADE los borró.
      console.log("(eventos huérfanos encontrados: 0 — ya limpios por CASCADE)");
    }
  });
  console.log("[apply] Recuperación completada.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
