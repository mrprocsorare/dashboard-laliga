import { createClient } from "@/lib/supabase/server";

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

/** Datos de la vista de equipo. Devuelve null si el slug no existe. */
export async function getTeamData(slug: string): Promise<{
  team: TeamRow;
  players: PlayerWithConsensus[];
  events: TeamEvent[];
  teamConsensus: TeamConsensusRow | null;
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

  const [playersRes, eventsRes, consensusRes] = await Promise.all([
    supabase
      .from("players")
      .select(
        "id, name, position, photo_url, player_consensus(probability_pct, sources_total, sources_starter, agreement, updated_at)",
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
      consensus: pc
        ? { ...pc, agreement: normalizeAgreement(pc.agreement) }
        : null,
    };
  });

  // Orden: probabilidad de consenso desc → nº de fuentes desc → nombre.
  // Los jugadores sin consenso (sin previsión) van al final por nombre.
  players.sort((a, b) => {
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
    players,
    events,
    teamConsensus: (consensusRes.data ?? null) as unknown as TeamConsensusRow | null,
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
        typeof (e as AgreementEntry).probability === "number",
    )
    .map((e) => ({
      source: e.source,
      probability: e.probability,
      fetched_at: String(e.fetched_at ?? ""),
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
