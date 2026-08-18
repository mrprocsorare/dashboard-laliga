import { createClient } from "@/lib/supabase/server";
import { getSorareData, type SorarePlayerData } from "@/lib/sorare";

/**
 * Capa de datos del dashboard. Lee de Supabase con la sesión del usuario
 * (RLS: SELECT para authenticated). Devuelve estructuras listas para
 * renderizar: ordenadas, deduplicadas y con los conteos hechos.
 */

export type Position = "POR" | "DEF" | "MED" | "DEL";
export type RunStatus = "running" | "success" | "partial" | "failed";
export type EventType = "injury" | "suspension" | "doubt" | "transfer";
export type Severity = "none" | "light" | "moderate" | "serious" | "out";

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  logo_url: string | null;
}

export interface SourceRow {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
}

export interface SourceStatus extends SourceRow {
  lastRunStatus: RunStatus | null;
  lastRunAt: string | null;
  lastRunError: string | null;
}

export interface AgreementEntry {
  source: string;
  probability: number;
  fetched_at: string;
  forecast_type: "probable" | "confirmed";
}

export interface ConsensusInfo {
  probability_pct: number;
  sources_total: number;
  sources_starter: number;
  agreement: AgreementEntry[];
  updated_at: string;
}

export interface PlayerWithConsensus {
  id: string;
  name: string;
  position: Position | null;
  photo_url: string | null;
  sorare_slug: string | null;
  sorare: SorarePlayerData | null;
  consensus: ConsensusInfo | null;
}

export interface TeamEvent {
  id: string;
  playerName: string;
  eventType: EventType;
  severity: Severity;
  reason: string | null;
  expectedReturn: string | null;
  note: string | null;
  recordedAt: string;
  sourceName: string;
}

export interface SetPieces {
  penalty: string[];
  corner: string[];
  free_kick: string[];
}

export interface TeamConsensusRow {
  formation: string | null;
  coach: string | null;
  set_pieces: SetPieces | null;
  updated_at: string;
}

export interface TeamSummary extends TeamRow {
  playersWithConsensus: number;
  likelyStarters: number;
}

export interface MatchOddsRow {
  id: string;
  external_event_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string;
  away_team_name: string;
  commence_time: string;
  matchday: number | null;
  probability_home_pct: number | null;
  probability_draw_pct: number | null;
  probability_away_pct: number | null;
  bookmaker: string | null;
  captured_at: string;
}

export interface JornadaMatch {
  odds: MatchOddsRow;
  homeTeam: TeamRow | null;
  awayTeam: TeamRow | null;
  homeXI: XIPlayer[];
  awayXI: XIPlayer[];
}

export interface JornadaData {
  currentMatchday: number | null;
  nextMatchday: number | null;
  matches: JornadaMatch[];
}

/** Ventana de frescura de los eventos (lesiones, sanciones…). */
const EVENTS_WINDOW_HOURS = 48;

/** Datos de la home: equipos con su cobertura de consenso + estado de fuentes. */
export async function getHomeData(): Promise<{
  teams: TeamSummary[];
  sources: SourceStatus[];
}> {
  const supabase = await createClient();

  const [teamsRes, sourcesRes, runsRes, playersRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, slug, name, short_name, logo_url")
      .order("name"),
    supabase.from("sources").select("id, slug, name, enabled").order("name"),
    supabase
      .from("scrape_runs")
      .select("source_id, status, finished_at, error_message")
      .order("started_at", { ascending: false })
      .limit(100),
    // Solo jugadores CON consenso (join inner): sirve para el resumen por equipo.
    supabase
      .from("players")
      .select("team_id, player_consensus!inner(probability_pct)"),
  ]);

  const teams = (teamsRes.data ?? []) as unknown as TeamRow[];
  const sources = (sourcesRes.data ?? []) as unknown as SourceRow[];

  // Última run por fuente (la lista ya viene ordenada de más reciente a más antigua).
  const latestRunBySource = new Map<
    string,
    { status: RunStatus; finished_at: string | null; error_message: string | null }
  >();
  for (const run of runsRes.data ?? []) {
    if (!latestRunBySource.has(run.source_id)) {
      latestRunBySource.set(run.source_id, {
        status: run.status as RunStatus,
        finished_at: run.finished_at,
        error_message: run.error_message,
      });
    }
  }

  // Cobertura de consenso por equipo.
  const coverage = new Map<string, { total: number; likely: number }>();
  type CoverageRow = {
    team_id: string;
    player_consensus: { probability_pct: number } | { probability_pct: number }[] | null;
  };
  for (const row of (playersRes.data ?? []) as unknown as CoverageRow[]) {
    const pc = Array.isArray(row.player_consensus)
      ? row.player_consensus[0]
      : row.player_consensus;
    if (!pc) continue;
    const entry = coverage.get(row.team_id) ?? { total: 0, likely: 0 };
    entry.total += 1;
    if (pc.probability_pct >= 60) entry.likely += 1;
    coverage.set(row.team_id, entry);
  }

  return {
    teams: teams.map((t) => ({
      ...t,
      playersWithConsensus: coverage.get(t.id)?.total ?? 0,
      likelyStarters: coverage.get(t.id)?.likely ?? 0,
    })),
    sources: sources.map((s) => {
      const run = latestRunBySource.get(s.id);
      return {
        ...s,
        lastRunStatus: run?.status ?? null,
        lastRunAt: run?.finished_at ?? null,
        lastRunError: run?.error_message ?? null,
      };
    }),
  };
}

/**
 * Datos de /jornada. Las cuotas no son una dependencia del consenso: si un
 * evento no tiene cuotas, se devuelve igualmente con probabilities null.
 */
export async function getJornadaData(): Promise<JornadaData> {
  const supabase = await createClient();
  const [oddsRes, teamsRes, playersRes] = await Promise.all([
    supabase
      .from("match_odds")
      .select(
        "id, external_event_id, home_team_id, away_team_id, home_team_name, away_team_name, commence_time, matchday, probability_home_pct, probability_draw_pct, probability_away_pct, bookmaker, captured_at",
      )
      .order("matchday", { ascending: true })
      .order("commence_time", { ascending: true }),
    supabase.from("teams").select("id, slug, name, short_name, logo_url").order("name"),
    supabase
      .from("players")
      .select(
        "id, team_id, name, position, photo_url, sorare_slug, player_consensus(probability_pct, sources_total, sources_starter, agreement, updated_at)",
      )
      .not("team_id", "is", null),
  ]);

  const odds = (oddsRes.data ?? []) as unknown as MatchOddsRow[];
  const teams = (teamsRes.data ?? []) as unknown as TeamRow[];
  type RawPlayer = Omit<PlayerWithConsensus, "consensus"> & {
    team_id: string;
    player_consensus: ConsensusInfo | ConsensusInfo[] | null;
  };
  const players = ((playersRes.data ?? []) as unknown as RawPlayer[]).map(({ player_consensus, ...p }) => {
    const pc = Array.isArray(player_consensus) ? (player_consensus[0] ?? null) : player_consensus;
    return {
      ...p,
      sorare: null,
      consensus: pc ? { ...pc, agreement: normalizeAgreement(pc.agreement) } : null,
    } as PlayerWithConsensus & { team_id: string };
  });

  const availableRounds = [...new Set(odds.map((o) => o.matchday).filter((v): v is number => v !== null))].sort(
    (a, b) => a - b,
  );
  const currentMatchday = availableRounds[0] ?? null;
  const nextMatchday = availableRounds[1] ?? null;
  const selectedOdds = odds.filter(
    (o) => o.matchday === currentMatchday || o.matchday === nextMatchday,
  );
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const playersByTeam = new Map<string, PlayerWithConsensus[]>();
  for (const player of players) {
    const list = playersByTeam.get(player.team_id) ?? [];
    list.push(player);
    playersByTeam.set(player.team_id, list);
  }

  const xiByMatch = new Map<string, { homeXI: XIPlayer[]; awayXI: XIPlayer[] }>();
  const visibleXI = selectedOdds.flatMap((oddsRow) => {
    const homeXI = oddsRow.home_team_id ? selectXI(playersByTeam.get(oddsRow.home_team_id) ?? []) : [];
    const awayXI = oddsRow.away_team_id ? selectXI(playersByTeam.get(oddsRow.away_team_id) ?? []) : [];
    xiByMatch.set(oddsRow.external_event_id, { homeXI, awayXI });
    return [...homeXI, ...awayXI];
  });
  const sorare = await getSorareData(visibleXI.map((player) => player.sorare_slug ?? ""));
  const withSorare = (xi: XIPlayer[]) =>
    xi.map((player) => ({
      ...player,
      sorare: player.sorare_slug ? sorare.get(player.sorare_slug) ?? null : null,
    }));

  return {
    currentMatchday,
    nextMatchday,
    matches: selectedOdds.map((oddsRow) => ({
      odds: oddsRow,
      homeTeam: oddsRow.home_team_id ? teamById.get(oddsRow.home_team_id) ?? null : null,
      awayTeam: oddsRow.away_team_id ? teamById.get(oddsRow.away_team_id) ?? null : null,
      homeXI: withSorare(xiByMatch.get(oddsRow.external_event_id)?.homeXI ?? []),
      awayXI: withSorare(xiByMatch.get(oddsRow.external_event_id)?.awayXI ?? []),
    })),
  };
}

/** Datos de la vista de equipo. Devuelve null si el slug no existe. */
export async function getTeamData(slug: string): Promise<{
  team: TeamRow;
  players: PlayerWithConsensus[];
  events: TeamEvent[];
  teamConsensus: TeamConsensusRow | null;
  upcomingMatches: MatchOddsRow[];
} | null> {
  const supabase = await createClient();

  const { data: team } = await supabase
    .from("teams")
    .select("id, slug, name, short_name, logo_url")
    .eq("slug", slug)
    .maybeSingle();
  if (!team) return null;

  const cutoff = new Date(
    Date.now() - EVENTS_WINDOW_HOURS * 3_600_000,
  ).toISOString();

  const [playersRes, eventsRes, consensusRes, matchesRes] = await Promise.all([
    supabase
      .from("players")
      .select(
        "id, name, position, photo_url, sorare_slug, player_consensus(probability_pct, sources_total, sources_starter, agreement, updated_at)",
      )
      .eq("team_id", team.id),
    supabase
      .from("player_events")
      .select(
        "id, player_id, event_type, severity, reason, expected_return, note, recorded_at, players!inner(name, team_id), sources(name)",
      )
      .eq("players.team_id", team.id)
      .gte("recorded_at", cutoff)
      .order("recorded_at", { ascending: false })
      .limit(500),
    supabase
      .from("team_consensus")
      .select("formation, coach, set_pieces, updated_at")
      .eq("team_id", team.id)
      .maybeSingle(),
    supabase
      .from("match_odds")
      .select(
        "id, external_event_id, home_team_id, away_team_id, home_team_name, away_team_name, commence_time, matchday, probability_home_pct, probability_draw_pct, probability_away_pct, bookmaker, captured_at",
      )
      .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
      .gte("commence_time", new Date().toISOString())
      .order("commence_time", { ascending: true })
      .limit(5),
  ]);

  type PlayerRowRaw = Omit<PlayerWithConsensus, "consensus"> & {
    player_consensus: ConsensusInfo | ConsensusInfo[] | null;
  };
  const players: PlayerWithConsensus[] = (
    (playersRes.data ?? []) as unknown as PlayerRowRaw[]
  ).map(({ player_consensus, ...p }) => {
    const pc = Array.isArray(player_consensus)
      ? (player_consensus[0] ?? null)
      : player_consensus;
    return {
      ...p,
      sorare: null,
      consensus: pc
        ? { ...pc, agreement: normalizeAgreement(pc.agreement) }
        : null,
    };
  });

  const sorare = await getSorareData(players.map((player) => player.sorare_slug ?? ""));
  const enrichedPlayers = players.map((player) => ({
    ...player,
    sorare: player.sorare_slug ? sorare.get(player.sorare_slug) ?? null : null,
  }));

  // Orden: probabilidad de consenso desc → nº de fuentes desc → nombre.
  // Los jugadores sin consenso (sin previsión) van al final por nombre.
  enrichedPlayers.sort((a, b) => {
    const pa = a.consensus?.probability_pct ?? -1;
    const pb = b.consensus?.probability_pct ?? -1;
    if (pa !== pb) return pb - pa;
    const sa = a.consensus?.sources_total ?? 0;
    const sb = b.consensus?.sources_total ?? 0;
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name, "es");
  });

  type EventRowRaw = {
    id: string;
    player_id: string;
    event_type: EventType;
    severity: Severity;
    reason: string | null;
    expected_return: string | null;
    note: string | null;
    recorded_at: string;
    players: { name: string } | { name: string }[] | null;
    sources: { name: string } | { name: string }[] | null;
  };

  // Eventos: append-only → nos quedamos con el ÚLTIMO por (jugador, fuente,
  // tipo). La lista viene ordenada de más reciente a más antigua.
  const seenEvent = new Set<string>();
  const events: TeamEvent[] = [];
  for (const row of (eventsRes.data ?? []) as unknown as EventRowRaw[]) {
    const key = `${row.player_id}:${row.event_type}:${sourceNameOf(row.sources)}`;
    if (seenEvent.has(key)) continue;
    seenEvent.add(key);
    events.push({
      id: row.id,
      playerName: playerNameOf(row.players),
      eventType: row.event_type,
      severity: row.severity,
      reason: row.reason,
      expectedReturn: row.expected_return,
      note: row.note,
      recordedAt: row.recorded_at,
      sourceName: sourceNameOf(row.sources),
    });
  }

  return {
    team: team as unknown as TeamRow,
    players: enrichedPlayers,
    events,
    teamConsensus: (consensusRes.data ?? null) as unknown as TeamConsensusRow | null,
    upcomingMatches: (matchesRes.data ?? []) as unknown as MatchOddsRow[],
  };
}

/** agreement llega como JSONB; lo normalizamos a array ordenado desc. */
function normalizeAgreement(raw: unknown): AgreementEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw
    .filter(
      (e): e is AgreementEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as AgreementEntry).source === "string" &&
        typeof (e as AgreementEntry).probability === "number" &&
        ((e as AgreementEntry).forecast_type === "probable" ||
          (e as AgreementEntry).forecast_type === "confirmed" ||
          (e as AgreementEntry).forecast_type === undefined),
    )
    .map((e) => ({
      source: e.source,
      probability: e.probability,
      fetched_at: String(e.fetched_at ?? ""),
      forecast_type: e.forecast_type ?? "probable",
    }));
  entries.sort((a, b) => b.probability - a.probability);
  return entries;
}

function firstRow<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function playerNameOf(v: { name: string } | { name: string }[] | null): string {
  return firstRow(v)?.name ?? "Desconocido";
}

function sourceNameOf(v: { name: string } | { name: string }[] | null): string {
  return firstRow(v)?.name ?? "Fuente";
}

export interface TeamNavInfo {
  slug: string;
  name: string;
  short_name: string;
  logo_url: string | null;
}

/** Todos los equipos ordenados por nombre (para el navegador entre equipos). */
export async function getAllTeamsForNav(): Promise<TeamNavInfo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("teams")
    .select("slug, name, short_name, logo_url")
    .order("name");
  return (data ?? []) as unknown as TeamNavInfo[];
}

export interface SourceInfo {
  slug: string;
  name: string;
  baseUrl: string;
}

/** Mapa slug → {name, baseUrl} para enlazar cada fuente en el desglose. */
export async function getSourceMap(): Promise<Map<string, SourceInfo>> {
  const supabase = await createClient();
  // Supabase-js no camelCase: la columna BD es `base_url`.
  const { data } = await supabase
    .from("sources")
    .select("slug, name, base_url");
  const map = new Map<string, SourceInfo>();
  for (const s of (data ?? []) as unknown as Array<{
    slug: string;
    name: string;
    base_url: string;
  }>) {
    map.set(s.slug, { slug: s.slug, name: s.name, baseUrl: s.base_url });
  }
  return map;
}

/** Jugador del once con la posición de formación (línea del campo) asignada. */
export interface XIPlayer extends PlayerWithConsensus {
  formationPosition: Position;
}

const FORMATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [4, 3, 3],
  [4, 4, 2],
  [3, 4, 3],
  [4, 5, 1],
  [3, 5, 2],
  [5, 3, 2],
  [5, 4, 1],
];

/**
 * Penalización por plaza rellenada con un jugador FUERA de su posición
 * almacenada (p. ej. un defensa metido en la línea de delanteros). Es lo que
 * hace que, cuando varias plantillas empatan a probabilidad total, gane la que
 * encaja de forma natural (todos en su línea) frente a las que fuerzan
 * jugadores a posiciones ajenas. Se aplica por plaza forzada.
 */
const POSITION_MISMATCH_PENALTY = 25;

/**
 * Selecciona el once más probable respetando formaciones reales (4-3-3,
 * 4-4-2, 3-4-3, …). Elige la formación que maximiza la probabilidad total del
 * once, eligiendo los mejores jugadores por línea. Las plazas sin cubrir por
 * esa posición se rellenan con el mejor jugador disponible; ese rellenado se
 * penaliza para preferir plantillas que encajan de forma natural. Nunca
 * produce más de 5 DEF, 5 MED, 3 DEL ni dos porteros.
 */
export function selectXI(players: PlayerWithConsensus[]): XIPlayer[] {
  const withPc = players.filter((p) => p.consensus !== null);
  if (withPc.length === 0) return [];

  const sorted = [...withPc].sort(
    (a, b) => b.consensus!.probability_pct - a.consensus!.probability_pct,
  );

  const gk = sorted.find((p) => p.position === "POR") ?? null;
  // El portero seleccionado NO compite por las plazas de campo.
  const pool = sorted.filter((p) => p !== gk);

  let best: { picked: XIPlayer[]; score: number } | null = null;

  for (const [nDEF, nMED, nDEL] of FORMATIONS) {
    const used = new Set<PlayerWithConsensus>();
    const picked: XIPlayer[] = [];
    const slots: Array<{ pos: Position; count: number }> = [
      { pos: "DEF", count: nDEF },
      { pos: "MED", count: nMED },
      { pos: "DEL", count: nDEL },
    ];

    for (const { pos, count } of slots) {
      // 1) Mejores `count` jugadores de esa posición. Importante: parar al
      // alcanzar `count` (no seguir cogiendo todos los que coincidan), si no
      // un slot de 4 DEF con 6 disponibles terminaría ocupando 6 plazas.
      for (const p of pool) {
        if (picked.length >= 10) break;
        if (picked.filter((x) => x.formationPosition === pos).length >= count) {
          break;
        }
        if (used.has(p)) continue;
        if (p.position === pos) {
          used.add(p);
          picked.push({ ...p, formationPosition: pos });
        }
      }
      // 2) Relleno: primero sin posición, luego cualquier disponible.
      let shortfall = count - picked.filter((x) => x.formationPosition === pos).length;
      if (shortfall > 0) {
        for (const p of pool) {
          if (shortfall === 0 || picked.length >= 10) break;
          if (used.has(p)) continue;
          if (p.position === null) {
            used.add(p);
            picked.push({ ...p, formationPosition: pos });
            shortfall--;
          }
        }
      }
      if (shortfall > 0) {
        for (const p of pool) {
          if (shortfall === 0 || picked.length >= 10) break;
          if (used.has(p)) continue;
          used.add(p);
          picked.push({ ...p, formationPosition: pos });
          shortfall--;
        }
      }
    }

    if (picked.length < 10) continue; // formación inviable por falta de jugadores

    // Score = probabilidad total − penalización por jugadores fuera de su
    // posición (favorece plantillas que encajan naturalmente).
    let score = 0;
    for (const p of picked) {
      score += p.consensus?.probability_pct ?? 0;
      if (p.position !== null && p.position !== p.formationPosition) {
        score -= POSITION_MISMATCH_PENALTY;
      }
    }

    if (!best || score > best.score) {
      best = { picked, score };
    }
  }

  if (best && gk) {
    return [{ ...gk, formationPosition: "POR" }, ...best.picked];
  }
  if (best) {
    // Sin portero disponible: devolvemos el once de campo tal cual.
    return best.picked;
  }

  // Fallback: no había 10 jugadores de campo suficientes para ninguna
  // formación → devolvemos los mejores disponibles sin imponer shape.
  const fallback = pool.slice(0, 10).map((p) => ({
    ...p,
    formationPosition: (p.position ?? "MED") as Position,
  }));
  return gk
    ? [{ ...gk, formationPosition: "POR" as Position }, ...fallback]
    : fallback;
}

/** Deriva la formación (ej: "4-3-3") del XI seleccionado. */
export function deriveFormation(xi: XIPlayer[]): string {
  const nDEF = xi.filter((p) => p.formationPosition === "DEF").length;
  const nMED = xi.filter((p) => p.formationPosition === "MED").length;
  const nDEL = xi.filter((p) => p.formationPosition === "DEL").length;
  return `${nDEF}-${nMED}-${nDEL}`;
}
