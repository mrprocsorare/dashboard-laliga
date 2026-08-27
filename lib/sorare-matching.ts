import { normalizeName } from "../services/player-names";

export interface LocalSorarePlayer {
  id: string;
  name: string;
  teamName: string;
  dateOfBirth?: string | null;
  nationality?: string | null;
}

export interface SorareCandidate {
  /** Identificador estable de Sorare (relay global id). No cambia si el slug cambia. */
  id?: string | null;
  slug: string;
  displayName: string;
  firstName: string;
  lastName: string;
  birthDay: string | null;
  nationality: string | null;
  activeClubName: string | null;
  activeClubSlug: string | null;
}

export interface RankedSorareCandidate extends SorareCandidate {
  confidence: number;
  nameScore: number;
  teamMatch: boolean;
  birthDateMatch: boolean;
  nationalityMatch: boolean;
  evidence: string[];
}

export interface SorareMatchDecision {
  status: "matched" | "manual_review" | "not_found";
  candidate: RankedSorareCandidate | null;
  confidence: number | null;
  method: string;
  reason: string;
  candidates: RankedSorareCandidate[];
}

const STOP_WORDS = new Set(["fc", "cf", "ud", "rcd", "ca", "club", "real", "de", "la", "el"]);
const TEAM_ALIASES: Array<{ key: string; aliases: string[] }> = [
  { key: "alaves", aliases: ["alaves", "deportivo alaves"] },
  { key: "athletic-bilbao", aliases: ["athletic bilbao", "athletic club", "athletic"] },
  { key: "atletico-madrid", aliases: ["atletico madrid", "atletico de madrid"] },
  { key: "barcelona", aliases: ["barcelona", "fc barcelona"] },
  { key: "betis", aliases: ["real betis", "betis"] },
  { key: "celta-vigo", aliases: ["celta vigo", "real club celta"] },
  { key: "deportivo", aliases: ["deportivo coruna", "deportivo la coruna"] },
  { key: "espanyol", aliases: ["espanyol", "rcd espanyol"] },
  { key: "getafe", aliases: ["getafe"] },
  { key: "girona", aliases: ["girona"] },
  { key: "las-palmas", aliases: ["las palmas", "union deportiva las palmas"] },
  { key: "levante", aliases: ["levante"] },
  { key: "mallorca", aliases: ["mallorca", "real mallorca"] },
  { key: "osasuna", aliases: ["osasuna"] },
  { key: "rayo-vallecano", aliases: ["rayo vallecano"] },
  { key: "real-madrid", aliases: ["real madrid"] },
  { key: "real-sociedad", aliases: ["real sociedad"] },
  { key: "sevilla", aliases: ["sevilla"] },
  { key: "valencia", aliases: ["valencia"] },
  { key: "villarreal", aliases: ["villarreal"] },
];

function clean(value: string | null | undefined): string {
  return normalizeName(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return clean(value).split(" ").filter((token) => token && !STOP_WORDS.has(token));
}

const GENERATIONAL = /\b(jr|junior|sr|senior|ii|iii|iv)\b/gi;

function nameTokens(value: string): string[] {
  return clean(value)
    .replace(GENERATIONAL, " ")
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function clubKey(value: string | null | undefined): string | null {
  const normalized = clean(value).replace(/-/g, " ");
  return TEAM_ALIASES.find((team) => team.aliases.some((alias) => normalized.includes(clean(alias))))?.key ?? null;
}

function clubMatches(localTeam: string, candidate: SorareCandidate): boolean {
  const localKey = clubKey(localTeam);
  const candidateKey = clubKey(`${candidate.activeClubName ?? ""} ${candidate.activeClubSlug ?? ""}`);
  if (localKey && candidateKey) return localKey === candidateKey;
  const localTokens = new Set(tokens(localTeam));
  const remoteTokens = new Set(tokens(`${candidate.activeClubName ?? ""} ${candidate.activeClubSlug ?? ""}`));
  const overlap = [...localTokens].filter((token) => remoteTokens.has(token));
  return overlap.length >= Math.min(2, localTokens.size) && overlap.length > 0;
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(nameTokens(left));
  const b = new Set(nameTokens(right));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return (2 * overlap) / (a.size + b.size);
}

function prefixTokenSimilarity(left: string, right: string): number {
  const a = new Set(nameTokens(left));
  const b = new Set(nameTokens(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb || ta.startsWith(tb) || tb.startsWith(ta)) {
        overlap++;
        break;
      }
    }
  }
  return (2 * overlap) / (a.size + b.size);
}

function slugProbeNameScore(localName: string, candidate: SorareCandidate): number {
  const candidateFullName = `${candidate.firstName} ${candidate.lastName}`.trim();
  const displayExact = clean(localName) !== "" && clean(localName) === clean(candidate.displayName);
  const fullExact = clean(localName) !== "" && clean(localName) === clean(candidateFullName);
  if (displayExact || fullExact) return 1;
  return Math.max(
    tokenSimilarity(localName, candidate.displayName),
    tokenSimilarity(localName, candidateFullName),
    prefixTokenSimilarity(localName, candidate.displayName),
    prefixTokenSimilarity(localName, candidateFullName),
  );
}

function sameDate(local: string | null | undefined, remote: string | null): boolean {
  return Boolean(local && remote && local.slice(0, 10) === remote.slice(0, 10));
}

function sameNationality(local: string | null | undefined, remote: string | null): boolean {
  return Boolean(local && remote && clean(local) === clean(remote));
}

function rank(local: LocalSorarePlayer, candidate: SorareCandidate): RankedSorareCandidate {
  const candidateFullName = `${candidate.firstName} ${candidate.lastName}`.trim();
  const localName = clean(local.name);
  const displayExact = localName !== "" && localName === clean(candidate.displayName);
  const fullExact = localName !== "" && localName === clean(candidateFullName);
  const nameScore = displayExact || fullExact
    ? 1
    : Math.max(
        tokenSimilarity(local.name, candidate.displayName),
        tokenSimilarity(local.name, candidateFullName),
        prefixTokenSimilarity(local.name, candidate.displayName),
        prefixTokenSimilarity(local.name, candidateFullName),
      );
  const teamMatch = clubMatches(local.teamName, candidate);
  const birthDateMatch = sameDate(local.dateOfBirth, candidate.birthDay);
  const nationalityMatch = sameNationality(local.nationality, candidate.nationality);
  const evidence: string[] = [];
  if (displayExact) evidence.push("display_name_exact");
  if (fullExact) evidence.push("full_name_exact");
  if (teamMatch) evidence.push("active_club");
  if (birthDateMatch) evidence.push("birth_day");
  if (nationalityMatch) evidence.push("nationality");
  const confidence = Math.min(
    1,
    (nameScore >= 1 ? 0.55 : nameScore * 0.55) +
      (teamMatch ? 0.25 : 0) +
      (birthDateMatch ? 0.25 : 0) +
      (nationalityMatch ? 0.05 : 0),
  );
  return { ...candidate, confidence, nameScore, teamMatch, birthDateMatch, nationalityMatch, evidence };
}

export function decideSorareMatch(
  local: LocalSorarePlayer,
  candidates: SorareCandidate[],
): SorareMatchDecision {
  const ranked = candidates
    .map((candidate) => rank(local, candidate))
    .sort((left, right) => right.confidence - left.confidence || right.nameScore - left.nameScore);
  const best = ranked[0] ?? null;
  const next = ranked[1] ?? null;
  if (!best) {
    return { status: "not_found", candidate: null, confidence: null, method: "none", reason: "sin_candidatos", candidates: [] };
  }

  const margin = best.confidence - (next?.confidence ?? 0);
  // Un nombre + fecha exactos siguen siendo identidad suficiente aunque el
  // club de Sorare ya refleje un traspaso. El club suma evidencia, pero no
  // debe convertir una cesión válida en un falso `manual_review`.
  const highIdentity =
    (best.birthDateMatch && best.nameScore >= 0.45) ||
    (best.teamMatch && best.nameScore === 1 && (best.birthDateMatch || !local.dateOfBirth)) ||
    (best.teamMatch && best.nameScore >= 0.72 && margin >= 0.15);
  if (highIdentity && margin >= 0.08) {
    const method = best.birthDateMatch
      ? best.teamMatch ? "name_club_birth_day" : "name_birth_day"
      : best.nameScore === 1
        ? "exact_name_club"
        : "name_club_unique_margin";
    return { status: "matched", candidate: best, confidence: best.confidence, method, reason: "evidencia_suficiente", candidates: ranked };
  }

  return {
    status: "manual_review",
    candidate: best,
    confidence: best.confidence,
    method: "review_required",
    reason: !best.teamMatch
      ? "club_no_coincide_o_no_disponible"
      : margin < 0.08
        ? "candidatos_ambiguos"
        : "identidad_insuficiente",
    candidates: ranked,
  };
}

export function decideSlugProbeMatch(
  local: LocalSorarePlayer,
  candidates: SorareCandidate[],
  variants: string[],
): SorareMatchDecision {
  if (!candidates.length) {
    return { status: "not_found", candidate: null, confidence: null, method: "none", reason: "sin_candidatos", candidates: [] };
  }

  let bestCandidate: SorareCandidate | null = null;
  let bestScore = -1;
  let bestExactSlug = false;

  for (const candidate of candidates) {
    const exactSlug = variants.includes(candidate.slug);
    const nameScore = slugProbeNameScore(local.name, candidate);
    const score = exactSlug ? 0.6 + nameScore * 0.4 : nameScore * 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestExactSlug = exactSlug;
    }
  }

  if (!bestCandidate) {
    return { status: "not_found", candidate: null, confidence: null, method: "none", reason: "sin_candidatos", candidates: [] };
  }

  const nameScore = slugProbeNameScore(local.name, bestCandidate);
  const ranked: RankedSorareCandidate = {
    ...bestCandidate,
    confidence: bestScore,
    nameScore,
    teamMatch: false,
    birthDateMatch: Boolean(local.dateOfBirth && bestCandidate.birthDay && local.dateOfBirth.slice(0, 10) === bestCandidate.birthDay.slice(0, 10)),
    nationalityMatch: Boolean(local.nationality && bestCandidate.nationality && clean(local.nationality) === clean(bestCandidate.nationality)),
    evidence: [
      bestExactSlug ? "exact_slug_probe" : "slug_variant_probe",
      ...(nameScore >= 0.9 ? ["name_exact"] : nameScore >= 0.5 ? ["name_close"] : []),
    ],
  };

  if (bestExactSlug && nameScore >= 0.4) {
    return {
      status: "matched",
      candidate: ranked,
      confidence: ranked.confidence,
      method: "slug_probe_exact",
      reason: "slug_probe_match",
      candidates: [ranked],
    };
  }

  if (nameScore >= 0.7) {
    return {
      status: "matched",
      candidate: ranked,
      confidence: ranked.confidence,
      method: "slug_probe_name",
      reason: "slug_probe_name_match",
      candidates: [ranked],
    };
  }

  return {
    status: "manual_review",
    candidate: ranked,
    confidence: ranked.confidence,
    method: "slug_probe_weak",
    reason: bestExactSlug ? "slug_probe_name_low" : "slug_probe_no_match",
    candidates: [ranked],
  };
}
