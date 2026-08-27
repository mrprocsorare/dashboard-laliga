import "dotenv/config";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../database/schema";

/**
 * Importa a `player_source_ids` SOLO los mappings marcados como verificados en
 * el CSV exportado por `export-sorare-notfound.ts`.
 *
 * Seguridad:
 *  - Modo dry-run por defecto; requiere --apply para escribir.
 *  - Solo upserta filas con verification_status == "verified" y con
 *    sorare_player_id + sorare_slug rellenos.
 *  - No sobrescribe un match ya existente y correcto: en el ON CONFLICT solo
 *    actualiza si el estado actual NO es "matched".
 *  - Detecta colisión de slug: si (source, external_slug) ya está "matched"
 *    para OTRO player_id, la fila se omite (no se pisa el match ajeno).
 *  - Detecta duplicados de slug dentro del propio fichero.
 */

const SOURCE_SLUG = "sorare";
const VERIFIED = new Set(["verified", "si", "yes", "true", "1", "x"]);

interface Row {
  player_id: string;
  sorare_player_id: string;
  sorare_slug: string;
  confidence: string;
  verification_status: string;
  verification_source: string;
  notes: string;
}

function csvParse(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const iId = idx("player_id");
  const iSpId = idx("sorare_player_id");
  const iSlug = idx("sorare_slug");
  const iConf = idx("confidence");
  const iStatus = idx("verification_status");
  const iSource = idx("verification_source");
  const iNotes = idx("notes");
  const out: Row[] = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = parseLine(lines[n]);
    out.push({
      player_id: cells[iId] ?? "",
      sorare_player_id: cells[iSpId] ?? "",
      sorare_slug: cells[iSlug] ?? "",
      confidence: cells[iConf] ?? "",
      verification_status: cells[iStatus] ?? "",
      verification_source: cells[iSource] ?? "",
      notes: cells[iNotes] ?? "",
    });
  }
  return out;
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function main() {
  const args = new Map<string, string>();
  let apply = false;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--file") args.set("file", process.argv[++i]);
    else if (a === "--source") args.set("source", process.argv[++i]);
  }
  const file = args.get("file");
  if (!file) throw new Error("Uso: npm run import:sorare-verified -- --file <csv> [--apply]");
  const sourceSlug = args.get("source") ?? SOURCE_SLUG;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const source = await db.query.sources.findFirst({
    where: eq(schema.sources.slug, sourceSlug),
  });
  if (!source) throw new Error(`Source "${sourceSlug}" no existe`);
  const sourceId = source.id;

  const rows = csvParse(readFileSync(file, "utf8"));
  const verified = rows.filter((r) => VERIFIED.has(r.verification_status.trim().toLowerCase()));

  const toApply: {
    playerId: string;
    externalPlayerId: string;
    externalSlug: string;
    confidence: number | null;
    matchMethod: string;
    reason: string;
  }[] = [];
  const skippedCollision: string[] = [];
  const skippedMissing: string[] = [];
  const seenSlugs = new Set<string>();

  for (const r of verified) {
    const spId = r.sorare_player_id.trim();
    const slug = r.sorare_slug.trim();
    if (!spId || !slug) {
      skippedMissing.push(r.player_id);
      continue;
    }
    if (seenSlugs.has(slug)) {
      skippedCollision.push(`${r.player_id} (slug duplicado en fichero: ${slug})`);
      continue;
    }
    const clash = await db
      .select({ playerId: schema.playerSourceIds.playerId })
      .from(schema.playerSourceIds)
      .where(
        and(
          eq(schema.playerSourceIds.sourceId, sourceId),
          eq(schema.playerSourceIds.externalSlug, slug),
          eq(schema.playerSourceIds.status, "matched"),
          sql`${schema.playerSourceIds.playerId} <> ${r.player_id}`,
        ),
      )
      .limit(1);
    if (clash.length > 0) {
      skippedCollision.push(`${r.player_id} (slug ya matched a otro: ${slug})`);
      continue;
    }
    seenSlugs.add(slug);
    const conf = r.confidence.trim();
    toApply.push({
      playerId: r.player_id,
      externalPlayerId: spId,
      externalSlug: slug,
      confidence: conf ? Number(conf) : null,
      matchMethod: r.verification_source.trim() || "manual_csv",
      reason: r.notes.trim() ? `manual_verified: ${r.notes.trim()}` : "manual_verified",
    });
  }

  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3650);
  let applied = 0;

  if (apply) {
    for (const m of toApply) {
      await db
        .insert(schema.playerSourceIds)
        .values({
          playerId: m.playerId,
          sourceId,
          externalPlayerId: m.externalPlayerId,
          externalSlug: m.externalSlug,
          status: "matched",
          isVerified: true,
          confidence: m.confidence,
          matchMethod: m.matchMethod,
          reason: m.reason,
          lastVerifiedAt: now,
          identityExpiresAt: expires,
          updatedAt: now,
          candidates: null,
        })
        .onConflictDoUpdate({
          target: [schema.playerSourceIds.playerId, schema.playerSourceIds.sourceId],
          set: {
            externalPlayerId: m.externalPlayerId,
            externalSlug: m.externalSlug,
            status: "matched",
            isVerified: true,
            confidence: m.confidence,
            matchMethod: m.matchMethod,
            reason: m.reason,
            lastVerifiedAt: now,
            identityExpiresAt: expires,
            updatedAt: now,
            candidates: null,
          },
          where: sql`${schema.playerSourceIds.status} <> 'matched'`,
        });
      applied++;
    }
  }

  await pool.end();

  console.log(`CSV: ${file}`);
  console.log(`Filas verificadas en CSV: ${verified.length} / ${rows.length} totales`);
  console.log(`A aplicar${apply ? " (APLICADO)" : " (dry-run)"}: ${toApply.length}`);
  console.log(`Omitidas por slug colisionado: ${skippedCollision.length}`);
  skippedCollision.forEach((s) => console.log(`  - ${s}`));
  console.log(`Omitidas por faltar ids: ${skippedMissing.length}`);
  skippedMissing.forEach((s) => console.log(`  - ${s}`));
  if (apply) console.log(`Insertadas/actualizadas: ${applied}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
