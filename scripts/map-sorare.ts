import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { searchSorarePlayersBatch } from "../lib/sorare";
import { players, teams } from "../database/schema";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øØ]/g, "o")
    .replace(/[ıİ]/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value: string): string {
  return value
    .replace(/\{\{.*$/, "")
    .replace(/\b\d+[ºª.]?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function searchNameFor(value: string): string | null {
  const cleaned = cleanName(value);
  const tokens = normalize(cleaned).split(" ").filter(Boolean);
  if (!cleaned || tokens.length === 0 || tokens[0] === "0") return null;
  const aliasFirst = FIRST_NAME_ALIASES[tokens[0]];
  if (tokens.length >= 2 && aliasFirst) return `${aliasFirst} ${tokens[1]}`;
  if (tokens.length >= 3) return tokens.slice(0, 2).join(" ");
  if (tokens.length === 2 && (tokens[0].length <= 3 || tokens[0].endsWith("."))) return tokens[1];
  return tokens.join(" ");
}

const FIRST_NAME_ALIASES: Record<string, string> = {
  fede: "federico",
  koke: "sergio",
  cuti: "cristian",
  tunde: "babatunde",
  pepelu: "jose luis",
  abde: "abdessamad",
  chupi: "carlos",
  chupe: "carlos",
};

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function editSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column++) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : 1 + Math.min(diagonal, previous[column - 1], above);
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function teamMatches(localTeam: string, activeClubName: string | null, activeClubSlug: string | null): boolean {
  if (!activeClubName && !activeClubSlug) return false;
  const local = new Set(tokens(localTeam));
  const remote = new Set(tokens(`${activeClubName ?? ""} ${activeClubSlug?.replace(/-/g, " ") ?? ""}`));
  const ignored = new Set(["fc", "cf", "ud", "rcd", "ca", "club", "real", "de", "la", "el"]);
  const meaningful = [...local].filter((token) => !ignored.has(token));
  return meaningful.length > 0 && meaningful.every((token) => remote.has(token));
}

interface RankedCandidate {
  slug: string;
  displayName: string;
  activeClubName: string | null;
  activeClubSlug: string | null;
  nameScore: number;
  score: number;
  teamMatch: boolean;
}

function rankCandidates(
  player: { name: string; teamName: string },
  candidates: Array<{
    slug: string;
    displayName: string;
    activeClubName: string | null;
    activeClubSlug: string | null;
  }>,
): RankedCandidate[] {
  const localTokens = tokens(player.name);
  const localFirst = localTokens[0] ?? "";
  const localLast = localTokens.at(-1) ?? "";
  const aliasFirst = FIRST_NAME_ALIASES[localFirst] ?? localFirst;

  return candidates
    .map((candidate) => {
      const candidateTokens = tokens(candidate.displayName);
      const overlap = candidateTokens.filter(
        (token) => localTokens.includes(token)
          || token === aliasFirst
          || localTokens.includes(FIRST_NAME_ALIASES[token] ?? "")
          || localTokens.some((localToken) => editSimilarity(localToken, token) >= 0.8),
      ).length;
      const tokenScore = localTokens.length && candidateTokens.length
        ? (2 * overlap) / (localTokens.length + candidateTokens.length)
        : 0;
      const exact = normalize(candidate.displayName) === normalize(player.name);
      const shortNameMatch = localTokens.length === 1 && candidateTokens[0] === localFirst;
      const lastNameMatch = candidateTokens.at(-1) === localLast;
      const nameScore = exact ? 1 : Math.min(1, tokenScore + (lastNameMatch ? 0.08 : 0) + (shortNameMatch ? 0.2 : 0));
      const hasTeamMatch = teamMatches(player.teamName, candidate.activeClubName, candidate.activeClubSlug);
      return {
        ...candidate,
        nameScore,
        teamMatch: hasTeamMatch,
        score: nameScore + (hasTeamMatch ? 0.2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || b.nameScore - a.nameScore);
}

function isSafeSuggestion(candidate: RankedCandidate | undefined, next: RankedCandidate | undefined): boolean {
  if (!candidate) return false;
  if (candidate.nameScore === 1 && !next) return true;
  const margin = candidate.score - (next?.score ?? 0);
  return (
    (candidate.nameScore >= 0.82 && (candidate.teamMatch || margin >= 0.12) && margin >= 0.08) ||
    (candidate.nameScore >= 0.68 && candidate.teamMatch && margin >= 0.08)
  );
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function writeReviewFile(path: string, rows: Array<Record<string, string>>): void {
  const columns = [
    "player_id",
    "team",
    "player_name",
    "search_name",
    "suggested_slug",
    "suggested_name",
    "confidence",
    "team_match",
    "candidates",
    "selected_slug",
    "notes",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column] ?? "")).join(","));
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function readReviewFile(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const columns = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1]) values.push(args[++index]);
    else if (args[index].startsWith(`${name}=`)) values.push(args[index].slice(name.length + 1));
  }
  return values;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const apply = process.argv.includes("--apply");
  const manualOnly = process.argv.includes("--manual-only");
  const assist = process.argv.includes("--assist");
  const reviewFile = optionValues("--review-file")[0] ?? "sorare-mapping-review.csv";
  const applyReview = optionValues("--apply-review")[0];
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const rows = await db
    .select({ id: players.id, name: players.name, sorareSlug: players.sorareSlug, teamName: teams.name })
    .from(players)
    .innerJoin(teams, eq(players.teamId, teams.id));

  if (applyReview) {
    const reviewRows = readReviewFile(applyReview);
    let applied = 0;
    for (const review of reviewRows) {
      const slug = review.selected_slug?.trim();
      if (!slug || /^(skip|none|-)$/i.test(slug)) continue;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug)) {
        console.log(`[skip] slug invalido para ${review.player_name}: ${slug}`);
        continue;
      }
      const player = rows.find((row) => row.id === review.player_id);
      if (!player) {
        console.log(`[skip] jugador no encontrado: ${review.player_id}`);
        continue;
      }
      await db.update(players).set({ sorareSlug: slug }).where(eq(players.id, player.id));
      applied++;
      console.log(`[review] ${player.name} (${player.teamName}) -> ${slug}`);
    }
    console.log(`Aplicados ${applied} mapeos desde ${applyReview}.`);
    await pool.end();
    return;
  }

  const manual = optionValues("--set");
  for (const mapping of manual) {
    const separator = mapping.indexOf("=");
    if (separator < 1 || separator === mapping.length - 1) {
      console.log(`Formato invalido para --set: ${mapping}. Usa "Nombre del jugador=slug".`);
      continue;
    }
    const playerRef = mapping.slice(0, separator).trim();
    const slug = mapping.slice(separator + 1).trim();
    const player = rows.find((row) => row.id === playerRef || normalize(row.name) === normalize(playerRef));
    if (!player) {
      console.log(`No encontrado: ${playerRef}`);
      continue;
    }
    console.log(`[manual] ${player.name} (${player.teamName}) -> ${slug}`);
    if (apply) await db.update(players).set({ sorareSlug: slug }).where(eq(players.id, player.id));
    player.sorareSlug = slug;
  }

  if (manualOnly) {
    console.log(apply ? "Mapeos manuales aplicados." : "Dry-run: usa --apply para aplicar los mapeos.");
    await pool.end();
    return;
  }

  const pending = rows.filter((row) => !row.sorareSlug);
  console.log(`Buscando ${pending.length} jugadores sin sorare_slug...`);
  if (assist) {
    const reviewRows: Array<Record<string, string>> = [];
    const searchBatchSize = 20;
    for (let index = 0; index < pending.length; index += searchBatchSize) {
      const batch = pending.slice(index, index + searchBatchSize);
      const searchable = batch
        .map((player, batchIndex) => ({ batchIndex, query: searchNameFor(player.name) }))
        .filter((entry): entry is { batchIndex: number; query: string } => Boolean(entry.query));
      const candidateLists = Array.from({ length: batch.length }, () => [] as Awaited<ReturnType<typeof searchSorarePlayersBatch>>[number]);
      const fetchedCandidates = await searchSorarePlayersBatch(searchable.map((entry) => entry.query));
      searchable.forEach((entry, searchIndex) => {
        candidateLists[entry.batchIndex] = fetchedCandidates[searchIndex] ?? [];
      });

      for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
        const player = batch[batchIndex];
        const ranked = rankCandidates(player, candidateLists[batchIndex] ?? []);
        const suggestion = ranked[0];
        const safe = isSafeSuggestion(suggestion, ranked[1]);
        const selectedSlug = safe && apply ? suggestion!.slug : "";
        if (selectedSlug) {
          await db.update(players).set({ sorareSlug: selectedSlug }).where(eq(players.id, player.id));
          console.log(`[assist] ${player.name} (${player.teamName}) -> ${selectedSlug}`);
        }
        reviewRows.push({
          player_id: player.id,
          team: player.teamName,
          player_name: player.name,
          search_name: searchNameFor(player.name) ?? "",
          suggested_slug: suggestion?.slug ?? "",
          suggested_name: suggestion?.displayName ?? "",
          confidence: suggestion ? suggestion.score.toFixed(2) : "",
          team_match: suggestion?.teamMatch ? "yes" : "no",
          candidates: ranked
            .slice(0, 8)
            .map((candidate) => `${candidate.slug} :: ${candidate.displayName} :: ${candidate.activeClubName ?? ""} :: ${candidate.score.toFixed(2)}`)
            .join(" | "),
          selected_slug: selectedSlug,
          notes: safe ? "auto-applied" : suggestion ? "review suggested_slug" : "no candidates",
        });
      }
      if (index + batch.length < pending.length) await sleep(61_000);
    }
    writeReviewFile(reviewFile, reviewRows);
    console.log(`Revision exportada a ${reviewFile}.`);
    console.log(apply ? "Mapeo asistido terminado; revisa los casos restantes en el CSV." : "Simulacion asistida terminada; completa selected_slug y usa --apply-review.");
    await pool.end();
    return;
  }

  const searchBatchSize = 20;
  for (let index = 0; index < pending.length; index += searchBatchSize) {
    const batch = pending.slice(index, index + searchBatchSize);
    const candidateLists = await searchSorarePlayersBatch(batch.map((player) => player.name));
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
      const player = batch[batchIndex];
      const candidates = candidateLists[batchIndex] ?? [];
      const exact = candidates.filter((candidate) => normalize(candidate.displayName) === normalize(player.name));
      if (exact.length === 1) {
        console.log(`[match] ${player.name} (${player.teamName}) -> ${exact[0].slug}`);
        if (apply) await db.update(players).set({ sorareSlug: exact[0].slug }).where(eq(players.id, player.id));
      } else if (candidates.length) {
        console.log(`[review] ${player.name} (${player.teamName}): ${candidates.map((c) => `${c.displayName}=${c.slug}`).join(" | ")}`);
      } else {
        console.log(`[none] ${player.name} (${player.teamName})`);
      }
    }
    if (index + batch.length < pending.length) await sleep(61_000);
  }

  console.log(apply ? "Mapeo terminado." : "Dry-run terminado: usa --apply para guardar coincidencias exactas.");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
