import { Pool } from "pg";
import { notInArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema";

const API_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "soccer_spain_la_liga";
const PREFERRED_BOOKMAKERS = ["pinnacle", "bet365", "betfair_ex_eu", "betsson"];

type Db = NodePgDatabase<typeof schema>;

interface OddsOutcome {
  name: string;
  price: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface MatchOddsData {
  externalEventId: string;
  homeTeamName: string;
  awayTeamName: string;
  commenceTime: Date;
  matchday: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  probabilityHomePct: number | null;
  probabilityDrawPct: number | null;
  probabilityAwayPct: number | null;
  bookmaker: string | null;
}

/**
 * Convierte cuotas decimales 1X2 en probabilidad implícita sin margen.
 * Es una aproximación simple de-vig, no una réplica del modelo interno de
 * cada casa: normalizamos los inversos de las tres cuotas disponibles.
 */
export function normalizeThreeWayOdds(
  home: number,
  draw: number,
  away: number,
): { home: number; draw: number; away: number } | null {
  if (![home, draw, away].every((v) => Number.isFinite(v) && v > 1)) return null;
  const invHome = 1 / home;
  const invDraw = 1 / draw;
  const invAway = 1 / away;
  const total = invHome + invDraw + invAway;
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    home: Math.round((invHome / total) * 100),
    draw: Math.round((invDraw / total) * 100),
    away: Math.round((invAway / total) * 100),
  };
}

function fetchJson<T>(url: string): Promise<T> {
  return fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "dashboard-laliga/1.0" },
    signal: AbortSignal.timeout(25_000),
  }).then(async (response) => {
    const body = await response.text();
    if (!response.ok) throw new Error(`The Odds API ${response.status}: ${body.slice(0, 300)}`);
    return JSON.parse(body) as T;
  });
}

function normalizeTeamName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(cf|fc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function externalTeamSlug(raw: string): string | null {
  const key = normalizeTeamName(raw);
  const aliases: Record<string, string> = {
    "deportivo la coruna": "deportivo-la-coruna",
    "deportivo de la coruna": "deportivo-la-coruna",
    alaves: "alaves",
    "athletic bilbao": "athletic-bilbao",
    "athletic club": "athletic-bilbao",
    "atletico madrid": "atletico-madrid",
    "atletico de madrid": "atletico-madrid",
    barcelona: "barcelona",
    "celta vigo": "celta-vigo",
    "celta de vigo": "celta-vigo",
    "elche": "elche",
    espanyol: "espanyol",
    getafe: "getafe",
    levante: "levante",
    malaga: "malaga",
    osasuna: "osasuna",
    "ca osasuna": "osasuna",
    racing: "racing-santander",
    "racing de santander": "racing-santander",
    "real racing club de santander": "racing-santander",
    "rayo vallecano": "rayo-vallecano",
    betis: "real-betis",
    "real betis": "real-betis",
    "real madrid": "real-madrid",
    "real sociedad": "real-sociedad",
    sevilla: "sevilla",
    valencia: "valencia",
    "villarreal": "villarreal",
  };
  return aliases[key] ?? null;
}

function extractThreeWay(
  event: OddsApiEvent,
): { bookmaker: OddsBookmaker; probabilities: { home: number; draw: number; away: number } } | null {
  const candidates = event.bookmakers
    .map((bookmaker) => ({ bookmaker, market: bookmaker.markets.find((m) => m.key === "h2h") }))
    .filter((v): v is { bookmaker: OddsBookmaker; market: OddsMarket } => Boolean(v.market));
  const ordered = [...candidates].sort((a, b) => {
    const ai = PREFERRED_BOOKMAKERS.indexOf(a.bookmaker.key);
    const bi = PREFERRED_BOOKMAKERS.indexOf(b.bookmaker.key);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
  });

  for (const { bookmaker, market } of ordered) {
    const home = market.outcomes.find((o) => o.name === event.home_team);
    const away = market.outcomes.find((o) => o.name === event.away_team);
    const draw = market.outcomes.find((o) => /^draw$/i.test(o.name));
    if (!home || !away || !draw) continue;
    const probabilities = normalizeThreeWayOdds(home.price, draw.price, away.price);
    if (probabilities) return { bookmaker, probabilities };
  }
  return null;
}

export async function fetchLaLigaOdds(apiKey = process.env.ODDS_API_KEY): Promise<OddsApiEvent[]> {
  if (!apiKey) throw new Error("Falta ODDS_API_KEY");
  const url = `${API_BASE}/sports/${SPORT_KEY}/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${encodeURIComponent(apiKey)}`;
  return fetchJson<OddsApiEvent[]>(url);
}

/** Devuelve eventos ordenados; cada bloque cronológico de 10 partidos es una jornada. */
export async function fetchAndNormalizeLaLigaOdds(pool: Pool): Promise<MatchOddsData[]> {
  const events = await fetchLaLigaOdds();
  const db = drizzle(pool, { schema }) as Db;
  const teams = await db.select({ id: schema.teams.id, slug: schema.teams.slug }).from(schema.teams);
  const teamMap = new Map(teams.map((t) => [t.slug, t.id]));
  const sorted = [...events].sort((a, b) => a.commence_time.localeCompare(b.commence_time));

  return sorted.map((event, index) => {
    const selected = extractThreeWay(event);
    return {
      externalEventId: event.id,
      homeTeamName: event.home_team,
      awayTeamName: event.away_team,
      commenceTime: new Date(event.commence_time),
      matchday: Math.floor(index / 10) + 1,
      homeTeamId: teamMap.get(externalTeamSlug(event.home_team) ?? "") ?? null,
      awayTeamId: teamMap.get(externalTeamSlug(event.away_team) ?? "") ?? null,
      probabilityHomePct: selected?.probabilities.home ?? null,
      probabilityDrawPct: selected?.probabilities.draw ?? null,
      probabilityAwayPct: selected?.probabilities.away ?? null,
      bookmaker: selected?.bookmaker.title ?? null,
    };
  });
}

export async function persistLaLigaOdds(pool: Pool): Promise<{ events: number; withOdds: number }> {
  const rows = await fetchAndNormalizeLaLigaOdds(pool);
  const db = drizzle(pool, { schema }) as Db;

  // La API devuelve la ventana vigente de eventos, no un histórico. Una vez
  // confirmado que la llamada fue válida y trajo eventos, eliminamos filas
  // que ya no aparecen (partidos comenzados o fuera de la ventana). Así la
  // página no conserva partidos obsoletos de una ejecución anterior.
  if (rows.length > 0) {
    await db
      .delete(schema.matchOdds)
      .where(notInArray(schema.matchOdds.externalEventId, rows.map((row) => row.externalEventId)));
  }

  for (const row of rows) {
    await db
      .insert(schema.matchOdds)
      .values(row)
      .onConflictDoUpdate({
        target: schema.matchOdds.externalEventId,
        set: {
          homeTeamId: row.homeTeamId,
          awayTeamId: row.awayTeamId,
          homeTeamName: row.homeTeamName,
          awayTeamName: row.awayTeamName,
          commenceTime: row.commenceTime,
          matchday: row.matchday,
          probabilityHomePct: row.probabilityHomePct,
          probabilityDrawPct: row.probabilityDrawPct,
          probabilityAwayPct: row.probabilityAwayPct,
          bookmaker: row.bookmaker,
          capturedAt: new Date(),
        },
      });
  }
  return { events: rows.length, withOdds: rows.filter((r) => r.bookmaker !== null).length };
}
