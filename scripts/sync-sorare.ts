import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";
import {
  SorareApiClient,
  SorareBudgetExceededError,
  SorareRateLimitError,
  type SorarePlayerResponse,
} from "../lib/sorare-client";
import {
  decideSorareMatch,
  decideSlugProbeMatch,
  type LocalSorarePlayer,
  type SorareCandidate,
} from "../lib/sorare-matching";
import { slugVariants } from "../lib/sorare-slugs";
import {
  SORARE_IDENTITY_TTL_MS,
  SORARE_PRICES_TTL_MS,
  SORARE_SCORES_TTL_MS,
  sorareRefreshPlan,
} from "../lib/sorare-sync-policy";

type Db = ReturnType<typeof drizzle>;
type LocalRow = LocalSorarePlayer & {
  teamId: string;
  canonicalName: string | null;
};

function searchName(row: LocalRow): string {
  return row.canonicalName?.trim() || row.name.trim();
}

function candidateFromResponse(player: SorarePlayerResponse): SorareCandidate {
  return {
    id: player.id ?? null,
    slug: player.slug,
    displayName: player.displayName,
    firstName: player.firstName,
    lastName: player.lastName,
    birthDay: player.birthDay,
    nationality: player.nationality,
    activeClubName: player.activeClubName,
    activeClubSlug: player.activeClubSlug,
  };
}

function localFromRow(row: LocalRow): LocalSorarePlayer {
  return {
    id: row.id,
    name: row.name,
    teamName: row.teamName,
    dateOfBirth: row.dateOfBirth,
    nationality: row.nationality,
  };
}

async function getSorareSourceId(db: Db): Promise<string> {
  const rows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.slug, "sorare"))
    .limit(1);
  if (!rows.length) {
    throw new Error("Fuente 'sorare' no encontrada en `sources`. Ejecuta db:migrate + db:seed.");
  }
  return rows[0].id;
}

/**
 * Escribe un mapeo en el puente genérico `player_source_ids`. Nunca toca
 * `players.sorare_slug` (legacy): la identidad Sorare vive en el puente.
 * Si el slug resultante ya está asignado a OTRO jugador, se deja en
 * `manual_review` (nunca se fuerza una asociación dudosa).
 */
async function upsertSourceId(
  db: Db,
  row: LocalRow,
  decision: ReturnType<typeof decideSorareMatch>,
  sourceId: string,
): Promise<void> {
  const now = new Date();
  let effective = decision;
  if (decision.status === "matched" && decision.candidate) {
    const occupied = await db
      .select({ playerId: schema.playerSourceIds.playerId })
      .from(schema.playerSourceIds)
      .where(
        and(
          eq(schema.playerSourceIds.sourceId, sourceId),
          eq(schema.playerSourceIds.externalSlug, decision.candidate.slug),
        ),
      )
      .limit(5);
    if (occupied.some((o) => o.playerId !== row.id)) {
      effective = {
        ...decision,
        status: "manual_review",
        method: "review_required",
        reason: "slug_ya_asignado_a_otro_jugador",
      };
    }
  }
  const candidate = effective.candidate;
  const base = {
    // Identidad estable de Sorare (relay id). El slug queda en externalSlug.
    externalPlayerId: effective.status === "matched" ? candidate?.id ?? null : null,
    externalSlug: candidate?.slug ?? null,
    externalName: candidate?.displayName ?? null,
    externalDob: candidate?.birthDay ?? null,
    externalClub: candidate?.activeClubName ?? null,
    confidence: effective.confidence,
    matchMethod: effective.method,
    isVerified: effective.status === "matched",
    status: effective.status,
    candidates: effective.candidates.slice(0, 8).map((item) => ({
      slug: item.slug,
      displayName: item.displayName,
      birthDay: item.birthDay,
      activeClubName: item.activeClubName,
      confidence: item.confidence,
      evidence: item.evidence,
    })),
    reason: effective.reason,
    lastVerifiedAt: effective.status === "matched" ? now : null,
    identityExpiresAt: effective.status === "matched" ? new Date(now.getTime() + SORARE_IDENTITY_TTL_MS) : null,
    updatedAt: now,
  };
  await db
    .insert(schema.playerSourceIds)
    .values({ playerId: row.id, sourceId, ...base })
    .onConflictDoUpdate({
      target: [schema.playerSourceIds.playerId, schema.playerSourceIds.sourceId],
      set: base,
    });
}

function summary(rows: LocalRow[], mappingStatus: Map<string, string>): void {
  const teams = new Map<string, { total: number; matched: number; pending: number; notFound: number }>();
  for (const row of rows) {
    const item = teams.get(row.teamName) ?? { total: 0, matched: 0, pending: 0, notFound: 0 };
    item.total++;
    const status = mappingStatus.get(row.id);
    if (status === "matched") item.matched++;
    else if (status === "not_found") item.notFound++;
    else item.pending++;
    teams.set(row.teamName, item);
  }
  const matched = [...mappingStatus.values()].filter((status) => status === "matched").length;
  const notFound = [...mappingStatus.values()].filter((status) => status === "not_found").length;
  console.log(`\nJugadores totales: ${rows.length}`);
  console.log(`Con Sorare: ${matched}`);
  console.log(`Pendientes: ${rows.length - matched - notFound}`);
  console.log(`No encontrados: ${notFound}`);
  console.log(`Cobertura: ${rows.length ? ((matched / rows.length) * 100).toFixed(1) : "0.0"}%`);
  for (const [team, item] of [...teams.entries()].sort(([left], [right]) => left.localeCompare(right, "es"))) {
    console.log(`${team}: ${item.matched}/${item.total} (${((item.matched / item.total) * 100).toFixed(1)}%) · pendientes ${item.pending} · no encontrados ${item.notFound}`);
  }
}

function scoreValues(player: SorarePlayerResponse): { scores: number[]; average: number | null; latest: number | null } {
  const scores = (player.playerGameScores ?? [])
    .map((item) => item.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  return {
    scores,
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    latest: scores[0] ?? null,
  };
}

async function persistPlayerData(db: Db, player: SorarePlayerResponse, refresh: { scores: boolean; classic: boolean; inSeason: boolean }): Promise<void> {
  const existing = await db
    .select()
    .from(schema.sorarePlayerCache)
    .where(eq(schema.sorarePlayerCache.sorareSlug, player.slug))
    .limit(1);
  const old = existing[0];
  const now = new Date();
  const score = scoreValues(player);
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
      scores: score.scores,
      averageScore: score.average,
      latestScore: score.latest,
      scoresUpdatedAt: refresh.scores ? now : old?.scoresUpdatedAt ?? now,
      scoresExpiresAt: refresh.scores ? new Date(now.getTime() + SORARE_SCORES_TTL_MS) : old?.scoresExpiresAt ?? now,
      classicPriceEurCents: refresh.classic ? price(player.classic) : old?.classicPriceEurCents ?? null,
      classicCardSlug: refresh.classic ? player.classic?.slug ?? null : old?.classicCardSlug ?? null,
      classicUpdatedAt: refresh.classic ? now : old?.classicUpdatedAt ?? now,
      classicExpiresAt: refresh.classic ? new Date(now.getTime() + SORARE_PRICES_TTL_MS) : old?.classicExpiresAt ?? now,
      inSeasonPriceEurCents: refresh.inSeason ? price(player.inSeason) : old?.inSeasonPriceEurCents ?? null,
      inSeasonCardSlug: refresh.inSeason ? player.inSeason?.slug ?? null : old?.inSeasonCardSlug ?? null,
      inSeasonUpdatedAt: refresh.inSeason ? now : old?.inSeasonUpdatedAt ?? now,
      inSeasonExpiresAt: refresh.inSeason ? new Date(now.getTime() + SORARE_PRICES_TTL_MS) : old?.inSeasonExpiresAt ?? now,
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
        scores: score.scores,
        averageScore: score.average,
        latestScore: score.latest,
        scoresUpdatedAt: refresh.scores ? now : old?.scoresUpdatedAt ?? now,
        scoresExpiresAt: refresh.scores ? new Date(now.getTime() + SORARE_SCORES_TTL_MS) : old?.scoresExpiresAt ?? now,
        classicPriceEurCents: refresh.classic ? price(player.classic) : old?.classicPriceEurCents ?? null,
        classicCardSlug: refresh.classic ? player.classic?.slug ?? null : old?.classicCardSlug ?? null,
        classicUpdatedAt: refresh.classic ? now : old?.classicUpdatedAt ?? now,
        classicExpiresAt: refresh.classic ? new Date(now.getTime() + SORARE_PRICES_TTL_MS) : old?.classicExpiresAt ?? now,
        inSeasonPriceEurCents: refresh.inSeason ? price(player.inSeason) : old?.inSeasonPriceEurCents ?? null,
        inSeasonCardSlug: refresh.inSeason ? player.inSeason?.slug ?? null : old?.inSeasonCardSlug ?? null,
        inSeasonUpdatedAt: refresh.inSeason ? now : old?.inSeasonUpdatedAt ?? now,
        inSeasonExpiresAt: refresh.inSeason ? new Date(now.getTime() + SORARE_PRICES_TTL_MS) : old?.inSeasonExpiresAt ?? now,
        lastError: null,
        updatedAt: now,
      },
    });
}

function price(card: SorarePlayerResponse["classic"]): number | null {
  if (!card) return null;
  const values = [
    card.publicMinPrices?.eurCents,
    card.liveSingleSaleOffer?.receiverSide?.amounts?.eurCents,
    card.liveSingleSaleOffer?.senderSide?.amounts?.eurCents,
    card.latestEnglishAuction?.bestBid?.amounts?.eurCents,
  ];
  return values.find((value): value is number => typeof value === "number" && value > 0) ?? null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  const sourceId = await getSorareSourceId(db);
  const now = Date.now();
  const rows = (await db
    .select({
      id: schema.players.id,
      name: schema.players.name,
      teamId: schema.players.teamId,
      dateOfBirth: schema.players.dateOfBirth,
      nationality: schema.players.nationality,
      canonicalName: schema.players.canonicalName,
      teamName: schema.teams.name,
    })
    .from(schema.players)
    .innerJoin(schema.teams, eq(schema.players.teamId, schema.teams.id))) as LocalRow[];
  const mappings = await db
    .select()
    .from(schema.playerSourceIds)
    .where(eq(schema.playerSourceIds.sourceId, sourceId));
  const mappingByPlayer = new Map(mappings.map((mapping) => [mapping.playerId, mapping]));
  const client = new SorareApiClient();
  const status = new Map<string, string>();
  const assignedSlugByPlayer = new Map<string, string>();
  for (const m of mappings) if (m.externalSlug) assignedSlugByPlayer.set(m.playerId, m.externalSlug);
  const [syncRun] = apply
    ? await db.insert(schema.sorareSyncRuns).values({ playersTotal: rows.length }).returning({ id: schema.sorareSyncRuns.id })
    : [{ id: null as string | null }];

  console.log(`${apply ? "[apply]" : "[dry-run]"} Procesando ${rows.length} jugadores de ${new Set(rows.map((row) => row.teamId)).size} equipos.`);
  const slugsToVerify = rows
    .map((row) => ({ row, m: mappingByPlayer.get(row.id) }))
    .filter(({ m }) => m && m.status === "matched" && (force || (m.identityExpiresAt?.getTime() ?? 0) <= now))
    .map(({ m }) => m!.externalSlug as string);
  const verified = new Map<string, SorarePlayerResponse>();
  try {
    for (const player of await client.getPlayers(slugsToVerify)) verified.set(player.slug, player);
  } catch (error) {
    console.warn(`[sync] verificación de slugs detenida: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const row of rows.filter((r) => {
    const m = mappingByPlayer.get(r.id);
    // Nunca downgradeamos un match ya verificado (manual o auto): confiamos en
    // la verificación previa y en el indice parcial que impide duplicados.
    return m && m.externalSlug && verified.has(m.externalSlug) && !m.isVerified;
  })) {
    const slug = mappingByPlayer.get(row.id)!.externalSlug!;
    const decision = decideSorareMatch(localFromRow(row), [candidateFromResponse(verified.get(slug)!)]);
    status.set(row.id, decision.status);
    if (decision.status === "matched" && decision.candidate) assignedSlugByPlayer.set(row.id, decision.candidate.slug);
    if (apply) await upsertSourceId(db, row, decision, sourceId);
  }

  if (process.argv.includes("--probe-slugs")) {
    const probeRows = rows.filter((row) => {
      const m = mappingByPlayer.get(row.id);
      const current = status.get(row.id);
      return !m?.externalSlug && current !== "matched" && (force || !m || m.status !== "matched");
    });
    const probeSlugs = [...new Set(probeRows.flatMap(slugVariants))];
    const probeResponses = new Map<string, SorarePlayerResponse>();
    try {
      for (const player of await client.getPlayers(probeSlugs)) probeResponses.set(player.slug, player);
    } catch (error) {
      console.warn(`[sync] sondeo de slugs detenido: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const row of probeRows) {
      const variants = slugVariants(row);
      const candidates = variants
        .map((slug) => probeResponses.get(slug))
        .filter((player): player is SorarePlayerResponse => Boolean(player))
        .map(candidateFromResponse);
      if (!candidates.length) continue;
      const decision = decideSlugProbeMatch(localFromRow(row), candidates, variants);
      status.set(row.id, decision.status);
      if (decision.status === "matched" && decision.candidate) assignedSlugByPlayer.set(row.id, decision.candidate.slug);
      if (apply) await upsertSourceId(db, row, decision, sourceId);
    }
  }

  const isAbbreviated = (row: LocalRow): boolean => {
    const name = searchName(row);
    return (
      /(^|\s)[A-Za-z]\.(?=\s|$)/.test(name) ||
      /\b(jr|junior|ii|iii|iv)\b/i.test(name) ||
      name.split(/\s+/).some((token) => token.length <= 2 && /[A-Za-z]/.test(token))
    );
  };
  const reviewRows = rows.filter((row) => {
    const m = mappingByPlayer.get(row.id);
    const current = status.get(row.id);
    const needsReview = current === undefined || current === "manual_review" || current === "not_found";
    return needsReview && (force || !m || m.status === "manual_review" || m.status === "not_found");
  });
  const pending = [...reviewRows].sort((left, right) => Number(isAbbreviated(right)) - Number(isAbbreviated(left)));
  const candidateMap = new Map<string, SorareCandidate[]>();
  try {
    const found = await client.searchPlayers(pending.map(searchName), 1);
    for (const row of pending) candidateMap.set(row.id, found.get(searchName(row)) ?? []);
  } catch (error) {
    console.warn(`[sync] búsquedas detenidas: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const row of pending) {
    const decision = decideSorareMatch(localFromRow(row), candidateMap.get(row.id) ?? []);
    status.set(row.id, decision.status);
    if (decision.status === "matched" && decision.candidate) assignedSlugByPlayer.set(row.id, decision.candidate.slug);
    if (apply) await upsertSourceId(db, row, decision, sourceId);
  }

  for (const row of rows) {
    if (!status.has(row.id)) {
      const m = mappingByPlayer.get(row.id);
      status.set(row.id, m?.status ?? (m?.externalSlug ? "manual_review" : "not_found"));
    }
  }

  const matchedSlugs = rows
    .filter((row) => status.get(row.id) === "matched" && assignedSlugByPlayer.has(row.id))
    .map((row) => assignedSlugByPlayer.get(row.id))
    .filter((slug): slug is string => Boolean(slug));
  const cacheRows = matchedSlugs.length
    ? await db.select().from(schema.sorarePlayerCache).where(inArray(schema.sorarePlayerCache.sorareSlug, matchedSlugs))
    : [];
  const cacheBySlug = new Map(cacheRows.map((row) => [row.sorareSlug, row]));
  const dataSlugs = matchedSlugs.filter((slug) => {
    const cache = cacheBySlug.get(slug);
    const plan = sorareRefreshPlan(cache, now, force);
    return (plan.scores || plan.classic || plan.inSeason) && !verified.has(slug);
  });
  try {
    const dataBySlug = new Map<string, SorarePlayerResponse>(verified);
    for (const player of await client.getPlayers(dataSlugs)) dataBySlug.set(player.slug, player);
    for (const player of dataBySlug.values()) {
      const cache = cacheBySlug.get(player.slug);
      if (apply) {
        await persistPlayerData(db, player, sorareRefreshPlan(cache, now, force));
      }
    }
  } catch (error) {
    console.warn(`[sync] datos de rendimiento/precios detenidos: ${error instanceof Error ? error.message : String(error)}`);
  }

  summary(rows, status);
  console.log(`Peticiones Sorare consumidas: ${client.callsUsed}`);
  if (syncRun.id) {
    const matched = [...status.values()].filter((value) => value === "matched").length;
    const notFound = [...status.values()].filter((value) => value === "not_found").length;
    await db
      .update(schema.sorareSyncRuns)
      .set({
        status: matched + notFound === rows.length ? "success" : "partial",
        mappingsMatched: matched,
        mappingsPending: rows.length - matched - notFound,
        mappingsNotFound: notFound,
        apiCalls: client.callsUsed,
        finishedAt: new Date(),
      })
      .where(eq(schema.sorareSyncRuns.id, syncRun.id));
  }
  if (!apply) console.log("Dry-run: usa --apply para guardar mappings y cache.");
  await pool.end();
}

main().catch((error) => {
  if (error instanceof SorareRateLimitError || error instanceof SorareBudgetExceededError) {
    console.error(`[sync] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
