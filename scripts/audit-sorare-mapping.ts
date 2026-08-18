import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";

const SORARE_ENDPOINT = "https://api.sorare.com/graphql";
const DEFAULT_INPUT = "sorare-mapping-review OK.csv";
const DEFAULT_REPORT = "sorare-mapping-audit.csv";
const DEFAULT_DUPLICATES = "sorare-duplicate-audit.csv";

interface ReviewRow {
  player_id: string;
  team: string;
  player_name: string;
  suggested_slug: string;
  selected_slug: string;
  notes: string;
}

interface DbPlayer {
  id: string;
  team: string;
  name: string;
  sorare_slug: string | null;
}

interface SorareIdentity {
  slug: string;
  displayName: string;
  firstName: string;
  lastName: string;
  birthDay: string | null;
  activeClub: { name: string; slug: string } | null;
}

function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
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

function readCsv(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const columns = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øØ]/g, "o")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function writeCsv(path: string, columns: string[], rows: Array<Record<string, string>>): void {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column] ?? "")).join(","));
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

async function sorareIdentities(slugs: string[]): Promise<Map<string, SorareIdentity>> {
  const query = `
    query AuditPlayers($slugs: [String!]) {
      players(slugs: $slugs) {
        slug
        displayName
        firstName
        lastName
        birthDay
        activeClub { name slug }
      }
    }
  `;
  const result = new Map<string, SorareIdentity>();
  for (let index = 0; index < slugs.length; index += 20) {
    const batch = slugs.slice(index, index + 20);
    const response = await fetch(SORARE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { slugs: batch } }),
    });
    const payload = (await response.json()) as {
      data?: { players?: SorareIdentity[] };
      errors?: Array<{ message: string }>;
    };
    if (!response.ok || payload.errors?.length) continue;
    for (const player of payload.data?.players ?? []) result.set(player.slug, player);
  }
  return result;
}

async function wikipediaUrl(name: string): Promise<{ url: string; source: string }> {
  const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&utf8=1&srlimit=1`;
  try {
    const response = await fetch(url);
    const payload = (await response.json()) as { query?: { search?: Array<{ title: string }> } };
    const title = payload.query?.search?.[0]?.title;
    const nameTokens = normalize(name).split(" ").filter((token) => token.length > 2);
    const titleTokens = normalize(title ?? "").split(" ").filter((token) => token.length > 2);
    const relevant = nameTokens.some((token) => titleTokens.includes(token));
    if (title && relevant) {
      return {
        url: `https://es.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        source: "Wikipedia search result",
      };
    }
    return {
      url: `https://www.transfermarkt.es/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}`,
      source: "Transfermarkt search",
    };
  } catch {
    return {
      url: `https://www.transfermarkt.es/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}`,
      source: "Transfermarkt search",
    };
  }
}

function clubMatches(localTeam: string, remoteTeam: string | null, remoteSlug: string | null): boolean | null {
  if (!remoteTeam && !remoteSlug) return null;
  const local = new Set(normalize(localTeam).split(" ").filter((token) => !["fc", "cf", "ud", "rcd", "ca", "club", "real", "de", "la", "el"].includes(token)));
  const remote = new Set(normalize(`${remoteTeam ?? ""} ${remoteSlug?.replace(/-/g, " ") ?? ""}`).split(" "));
  return [...local].length > 0 && [...local].every((token) => remote.has(token));
}

function similarity(local: string, remote: string): string {
  const left = new Set(normalize(local).split(" ").filter(Boolean));
  const right = new Set(normalize(remote).split(" ").filter(Boolean));
  const overlap = [...left].filter((token) => right.has(token)).length;
  return `${overlap}/${Math.max(left.size, right.size)}`;
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

function duplicateConfidence(first: DbPlayer, second: DbPlayer): string | null {
  if (first.sorare_slug && first.sorare_slug === second.sorare_slug) return "confirmed_same_sorare_slug";
  const firstTokens = normalize(first.name).split(" ").filter(Boolean);
  const secondTokens = normalize(second.name).split(" ").filter(Boolean);
  const withoutInitials = (items: string[]) => items.filter((token) => token.length > 1);
  if (withoutInitials(firstTokens).join(" ") === withoutInitials(secondTokens).join(" ")) return "high_name_match";
  const firstLast = firstTokens.at(-1) ?? "";
  const secondLast = secondTokens.at(-1) ?? "";
  const firstShared = firstTokens.slice(0, 2).filter((token) => secondTokens.slice(0, 2).includes(token)).length;
  if (firstLast === secondLast && (firstTokens[0]?.length === 1 || secondTokens[0]?.length === 1)) return "possible_initial_alias";
  if (firstShared >= 2 && editSimilarity(firstLast, secondLast) >= 0.75) return "possible_typo_or_compound_name";
  return null;
}

async function main() {
  const input = option("--input", DEFAULT_INPUT);
  const reportPath = option("--report", DEFAULT_REPORT);
  const duplicatePath = option("--duplicates", DEFAULT_DUPLICATES);
  const auditAllMapped = process.argv.includes("--all-mapped");
  const reviewRows = readCsv(input) as unknown as ReviewRow[];
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");

  const client = new Client({ connectionString });
  await client.connect();
  const dbRows = (await client.query<DbPlayer>(
    "select players.id, teams.name as team, players.name, players.sorare_slug from players join teams on teams.id = players.team_id",
  )).rows;
  const dbById = new Map(dbRows.map((row) => [row.id, row]));
  const selectedRows = auditAllMapped
    ? dbRows
        .filter((row) => row.sorare_slug)
        .map((row) => ({
          player_id: row.id,
          team: row.team,
          player_name: row.name,
          suggested_slug: row.sorare_slug ?? "",
          selected_slug: row.sorare_slug ?? "",
          notes: "all mapped audit",
        }))
    : reviewRows.filter((row) => row.selected_slug.trim() || row.notes === "review suggested_slug");
  const identities = await sorareIdentities([...new Set(selectedRows.map((row) => row.selected_slug.trim()))]);
  const wikiCache = new Map<string, { url: string; source: string }>();

  const report: Array<Record<string, string>> = [];
  for (const row of selectedRows) {
    const slug = row.selected_slug.trim();
    const identity = identities.get(slug);
    const dbRow = dbById.get(row.player_id);
    const externalSource = auditAllMapped
      ? { url: "", source: "" }
      : (wikiCache.get(row.player_name) ?? await wikipediaUrl(row.player_name));
    if (!auditAllMapped && !wikiCache.has(row.player_name)) wikiCache.set(row.player_name, externalSource);
    const match = identity ? clubMatches(row.team, identity.activeClub?.name ?? null, identity.activeClub?.slug ?? null) : null;
    const status = !slug
      ? "NO_DECISION_IN_REVIEW"
      : !identity
      ? "INVALID_SLUG_NOT_FOUND"
      : match === false
        ? "REVIEW_CLUB_MISMATCH"
        : "VERIFIED_API_IDENTITY";
    report.push({
      player_id: row.player_id,
      player_name: row.player_name,
      team: row.team,
      slug_anterior: dbRow?.sorare_slug ?? "",
      slug_verificado_nuevo: slug,
      cambia: (dbRow?.sorare_slug ?? "") === slug ? "no" : "yes",
      sorare_exists: identity ? "yes" : "no",
      sorare_display_name: identity?.displayName ?? "",
      sorare_birth_day: identity?.birthDay ?? "",
      sorare_active_club: identity?.activeClub?.name ?? "",
      club_match: match === null ? "unknown" : match ? "yes" : "no",
      sorare_url: `https://sorare.com/football/players/${slug}`,
      external_source_url: externalSource.url,
      source_used: auditAllMapped ? "Sorare GraphQL API" : slug ? `Sorare GraphQL API; ${externalSource.source}` : externalSource.source,
      verification_status: status,
      original_review_notes: row.notes,
    });
  }

  const duplicateRows: Array<Record<string, string>> = [];
  for (let left = 0; left < dbRows.length; left++) {
    for (let right = left + 1; right < dbRows.length; right++) {
      const first = dbRows[left];
      const second = dbRows[right];
      if (first.team !== second.team) continue;
      const confidence = duplicateConfidence(first, second);
      if (confidence) {
        duplicateRows.push({
          team: first.team,
          player_id_1: first.id,
          player_name_1: first.name,
          sorare_slug_1: first.sorare_slug ?? "",
          player_id_2: second.id,
          player_name_2: second.name,
          sorare_slug_2: second.sorare_slug ?? "",
          name_similarity: similarity(first.name, second.name),
          confidence,
          recommended_action: "VERIFY_IDENTITY_BEFORE_MERGE",
        });
      }
    }
  }
  await client.end();

  writeCsv(reportPath, Object.keys(report[0] ?? {}), report);
  writeCsv(duplicatePath, Object.keys(duplicateRows[0] ?? {
    team: "",
    player_id_1: "",
    player_name_1: "",
    sorare_slug_1: "",
    player_id_2: "",
    player_name_2: "",
    sorare_slug_2: "",
    name_similarity: "",
    confidence: "",
    recommended_action: "",
  }), duplicateRows);
  console.log(`Auditados ${report.length} slugs seleccionados.`);
  console.log(`Reporte: ${reportPath}`);
  console.log(`Duplicados candidatos: ${duplicateRows.length} en ${duplicatePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
