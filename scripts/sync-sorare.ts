import "dotenv/config";

import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { normalizeName } from "../services/player-names";
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
import {
  SORARE_IDENTITY_TTL_MS,
  SORARE_PRICES_TTL_MS,
  SORARE_SCORES_TTL_MS,
  sorareRefreshPlan,
} from "../lib/sorare-sync-policy";

type Db = ReturnType<typeof drizzle>;
type LocalRow = LocalSorarePlayer & {
  teamId: string;
  sorareSlug: string | null;
  canonicalName: string | null;
};

function searchName(row: LocalRow): string {
  return row.canonicalName?.trim() || row.name.trim();
}

function slugVariants(row: LocalRow): string[] {
  const raw = searchName(row)
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\b\d+(?:er|nd|rd|th|o|a)?\b/g, " ")
    .replace(/\b(jr|junior|ii|iii|iv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeName(raw).trim();
  if (!normalized) return [];

  const isInitial = (token: string) => /^[a-z]\.?$/.test(token);
  const isParticle = (token: string) =>
    ["de", "da", "do", "del", "das", "dos"].includes(token);

  const allParts = normalized.split(" ").filter(Boolean);
  const significant = allParts.filter((p) => p.length > 1 || isInitial(p));
  if (!significant.length) return [];

  const first = significant[0];
  const last = significant.at(-1);
  const values = new Set<string>();

  const push = (slug: string) => {
    const clean = slug.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (clean.length >= 3) values.add(clean);
  };

  // Full name with particles (e.g. inigo-ruiz-de-galarreta)
  push(significant.join("-"));

  // first-last (most common Sorare pattern)
  if (significant.length >= 2) push(`${first}-${last}`);

  // first-two tokens
  if (significant.length >= 3) push(significant.slice(0, 2).join("-"));

  // last-two tokens
  if (significant.length >= 3) push(significant.slice(-2).join("-"));

  // first-only (mononym: Koke, Bordalás)
  if (first.length >= 3) push(first);

  // last-only (surname reference: Budimir, etc.)
  if (last && last.length >= 3 && last !== first) push(last);

  // Particles-skipped first-last: e.g. "Antony dos Santos" → "antony-santos"
  const noParticles = significant.filter((p) => !isParticle(p));
  if (noParticles.length >= 2) {
    push(`${noParticles[0]}-${noParticles.at(-1)}`);
    if (noParticles.length >= 3) push(noParticles.slice(0, 2).join("-"));
  }

  // Initial-based: "s-flores", "j-castro"
  if (isInitial(first) && significant.length >= 2) {
    push(`${first.replace(".", "")}-${last}`);
  }

  // If the name starts with an initial + significant, also try the significant parts alone
  if (isInitial(first) && significant.length >= 3) {
    push(significant.slice(1).join("-"));
  }

  return [...values];
}

function candidateFromResponse(player: SorarePlayerResponse): SorareCandidate {
  return {
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

function mappingValues(
  row: LocalRow,
  decision: ReturnType<typeof decideSorareMatch>,
  now: Date,
) {
  const candidate = decision.candidate;
  return {
    playerId: row.id,
    // Un candidato dudoso queda documentado en `candidates` y no ocupa el
    // slug de compatibilidad ni la unicidad del mapping.
    sorareSlug: decision.status === "matched" ? candidate?.slug ?? null : null,
    displayName: candidate?.displayName ?? null,
    firstName: candidate?.firstName ?? null,
    lastName: candidate?.lastName ?? null,
    birthDay: candidate?.birthDay ?? null,
    nationality: candidate?.nationality ?? null,
    activeClubName: candidate?.activeClubName ?? null,
    activeClubSlug: candidate?.activeClubSlug ?? null,
    matchingMethod: decision.method,
    confidence: decision.confidence,
    status: decision.status,
    reason: decision.reason,
    candidates: decision.candidates.slice(0, 8).map((item) => ({
      slug: item.slug,
      displayName: item.displayName,
      birthDay: item.birthDay,
      activeClubName: item.activeClubName,
      confidence: item.confidence,
      evidence: item.evidence,
    })),
    lastVerifiedAt: decision.status === "matched" ? now : null,
    identityExpiresAt: decision.status === "matched" ? new Date(now.getTime() + SORARE_IDENTITY_TTL_MS) : null,
    updatedAt: now,
  };
}

async function upsertMapping(db: Db, row: LocalRow, decision: ReturnType<typeof decideSorareMatch>): Promise<void> {
  const now = new Date();
  let effectiveDecision = decision;
  if (decision.status === "matched" && decision.candidate) {
    const occupied = await db
      .select({ playerId: schema.sorarePlayerMappings.playerId })
      .from(schema.sorarePlayerMappings)
      .where(eq(schema.sorarePlayerMappings.sorareSlug, decision.candidate.slug))
      .limit(1);
    if (occupied[0] && occupied[0].playerId !== row.id) {
      effectiveDecision = {
        ...decision,
        status: "manual_review",
        method: "review_required",
        reason: "slug_ya_asignado_a_otro_jugador",
      };
    }
  }
  await db
    .insert(schema.sorarePlayerMappings)
    .values(mappingValues(row, effectiveDecision, now))
    .onConflictDoUpdate({
      target: schema.sorarePlayerMappings.playerId,
      set: mappingValues(row, effectiveDecision, now),
    });
  if (effectiveDecision.status === "matched" && effectiveDecision.candidate) {
    await db.update(schema.players).set({ sorareSlug: effectiveDecision.candidate.slug }).where(eq(schema.players.id, row.id));
  }
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
    card.liveSingleSaleOffer?.senderSide.amounts.eurCents,
    card.latestEnglishAuction?.bestBid?.amounts.eurCents,
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
  const now = Date.now();
  const rows = (await db
    .select({
      id: schema.players.id,
      name: schema.players.name,
      teamId: schema.players.teamId,
      sorareSlug: schema.players.sorareSlug,
      dateOfBirth: schema.players.dateOfBirth,
      nationality: schema.players.nationality,
      canonicalName: schema.players.canonicalName,
      teamName: schema.teams.name,
    })
    .from(schema.players)
    .innerJoin(schema.teams, eq(schema.players.teamId, schema.teams.id))) as LocalRow[];
  const mappings = await db.select().from(schema.sorarePlayerMappings);
  const mappingByPlayer = new Map(mappings.map((mapping) => [mapping.playerId, mapping]));
  const client = new SorareApiClient();
  const status = new Map<string, string>();
  const assignedSlugByPlayer = new Map<string, string>();
  const [syncRun] = apply
    ? await db.insert(schema.sorareSyncRuns).values({ playersTotal: rows.length }).returning({ id: schema.sorareSyncRuns.id })
    : [{ id: null as string | null }];
  for (const row of rows) if (row.sorareSlug) assignedSlugByPlayer.set(row.id, row.sorareSlug);

  console.log(`${apply ? "[apply]" : "[dry-run]"} Procesando ${rows.length} jugadores de ${new Set(rows.map((row) => row.teamId)).size} equipos.`);
  const slugsToVerify = rows
    .filter((row) => row.sorareSlug)
    .filter((row) => {
      const expiresAt = mappingByPlayer.get(row.id)?.identityExpiresAt?.getTime() ?? 0;
      return force || mappingByPlayer.get(row.id)?.status !== "matched" || expiresAt <= now;
    })
    .map((row) => row.sorareSlug as string);
  const verified = new Map<string, SorarePlayerResponse>();
  try {
    for (const player of await client.getPlayers(slugsToVerify)) verified.set(player.slug, player);
  } catch (error) {
    console.warn(`[sync] verificación de slugs detenida: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const row of rows.filter((item) => item.sorareSlug && verified.has(item.sorareSlug))) {
    const decision = decideSorareMatch(localFromRow(row), [candidateFromResponse(verified.get(row.sorareSlug!)!)]);
    status.set(row.id, decision.status);
    if (decision.status === "matched" && decision.candidate) assignedSlugByPlayer.set(row.id, decision.candidate.slug);
    if (apply) await upsertMapping(db, row, decision);
  }

  if (process.argv.includes("--probe-slugs")) {
    const probeRows = rows.filter((row) => {
      const old = mappingByPlayer.get(row.id);
      const current = status.get(row.id);
      return !row.sorareSlug && current !== "matched" && (force || !old || old.status !== "matched");
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
      if (apply) await upsertMapping(db, row, decision);
    }
  }

  const pending = rows.filter((row) => {
    const old = mappingByPlayer.get(row.id);
    const current = status.get(row.id);
    return (current === undefined || current === "manual_review") && (force || !old || old.status === "manual_review");
  });
  const candidateMap = new Map<string, SorareCandidate[]>();
  try {
    const found = await client.searchPlayers(pending.map(searchName), 2);
    for (const row of pending) candidateMap.set(row.id, found.get(searchName(row)) ?? []);
  } catch (error) {
    console.warn(`[sync] búsquedas detenidas: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const row of pending) {
    const decision = decideSorareMatch(localFromRow(row), candidateMap.get(row.id) ?? []);
    status.set(row.id, decision.status);
    if (decision.status === "matched" && decision.candidate) assignedSlugByPlayer.set(row.id, decision.candidate.slug);
    if (apply) await upsertMapping(db, row, decision);
  }

  for (const row of rows) {
    if (!status.has(row.id)) {
      const old = mappingByPlayer.get(row.id);
      status.set(row.id, old?.status ?? (row.sorareSlug ? "manual_review" : "not_found"));
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
