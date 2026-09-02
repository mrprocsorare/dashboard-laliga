import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { ParseError } from "../../errors";
import type { Position, EventType, Severity } from "../../types";
import {
  jornadaPerfectaConfig,
  JP_TEAM_SLUGS_BY_LENGTH,
  type JornaPerfectaTeamSlug,
} from "./config";

/** Un partido de la jornada con sus dos slugs canónicos. */
export interface ParsedMatch {
  matchUrl: string;
  local: string;
  visitante: string;
}

/** Jugador con su probabilidad de titularidad. */
export interface ParsedPlayer {
  name: string;
  probabilityPct: number;
  position: Position | null;
  photoUrl: string | null;
}

/** Evento de lesión/sanción declarado por la fuente. */
export interface ParsedEvent {
  playerName: string;
  eventType: EventType;
  severity: Severity;
  reason: string | null;
  note: string | null;
}

/** Bloque completo de un equipo dentro de la página de partido. */
export interface ParsedTeamBlock {
  players: ParsedPlayer[];
  events: ParsedEvent[];
}

const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

/** Resuelve el tail de una URL de partido (`{local}-{visitante}`) a slugs
 *  canónicos. Ej: "real-madrid-real-sociedad" → local/visitante. */
export function resolveMatchSlugs(tail: string): string | null {
  const map = jornadaPerfectaConfig.teamSlugToCanonical;
  for (const a of JP_TEAM_SLUGS_BY_LENGTH) {
    for (const b of JP_TEAM_SLUGS_BY_LENGTH) {
      if (tail === `${a}-${b}`) {
        return `${map[a as JornaPerfectaTeamSlug]}|${map[b as JornaPerfectaTeamSlug]}`;
      }
    }
  }
  return null;
}

/** Devuelve la lista de partidos de la jornada actual desde la homepage. */
export function parseMatchIndex(html: string): ParsedMatch[] {
  const $ = cheerio.load(html);
  const matches: ParsedMatch[] = [];
  const seen = new Set<string>();

  $("a.match-detail[href*='/partido/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/partido\/(\d+)\/([a-z0-9-]+)$/);
    if (!m) return;
    const matchId = m[1];
    const tail = m[2];
    const resolved = resolveMatchSlugs(tail);
    if (!resolved) return;
    const [local, visitante] = resolved.split("|");
    if (!local || !visitante || seen.has(matchId)) return;
    seen.add(matchId);
    matches.push({ matchUrl: `/partido/${matchId}/${tail}`, local, visitante });
  });

  if (matches.length === 0) {
    throw new ParseError("No se encontraron partidos de LaLiga en la homepage.");
  }
  return matches;
}

/**
 * Parsea la página de partido: un `div.campo-futbol.lineas-4` por equipo
 * (distingue por `div.escudo-equipo-alineacion img[title]` y por orden) y los
 * no disponibles de cada equipo en `#unavailable`.
 */
export function parseMatchPage(
  html: string,
): { [key: string]: ParsedTeamBlock } {
  const result: { [key: string]: ParsedTeamBlock } = {
    local: { players: [], events: [] },
    visitante: { players: [], events: [] },
  };
  const $ = cheerio.load(html);

  // Cada equipo vive en un contenedor: tres niveles por encima del elemento
  // div.campo-futbol se encuentra el div que agrupa también sus #unavailable.
  // Subimos los ancestros desde cada campo y deduplicamos.
  const scopes: Element[] = [];
  $("div.campo-futbol").each((_, campo) => {
    const scope =
      $(campo).closest("[data-lineup-export-root]").parent().get(0) ??
      $(campo).parent().parent().parent().get(0);
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  });

  const sides: Array<"local" | "visitante"> = ["local", "visitante"];

  scopes.slice(0, 2).forEach((scope, idx) => {
    const side = sides[idx] ?? "local";
    const campo = $(scope).find("div.campo-futbol").first();
    result[side].players = parseFieldPlayers($, campo.get(0));
    result[side].events = parseUnavailable($, scope);
  });

  return result;
}

/** Parsea los jugadores del once de un `div.campo-futbol`. */
function parseFieldPlayers($: cheerio.CheerioAPI, campo: Element | undefined): ParsedPlayer[] {
  const players: ParsedPlayer[] = [];
  const seen = new Set<string>();
  if (!campo) return players;

  $(campo)
    .find("a.player")
    .each((_, el) => {
      const alt = $(el).find("img.face").attr("alt") ?? "";
      const name = cleanText(alt.replace(/^Cara de\s+/i, ""));
      if (!name || seen.has(name)) return;
      seen.add(name);

      // Fila del campo → posición.
      const filaClass = $(el).closest("[class*='linea-']").attr("class") ?? "";
      const lineaMatch = filaClass.match(/linea-(\d)/);
      const position = mapLineaToPosition(lineaMatch ? parseInt(lineaMatch[1], 10) : undefined);

      // % de titularidad (vacío = fijo en el once).
      const pctText = $(el).find(".percent-budget").first().text().trim();
      const pct = parseInt(pctText.replace(/[^0-9]/g, ""), 10);
      const probabilityPct = Number.isNaN(pct) ? 100 : pct;

      // Foto.
      let photoUrl: string | null = null;
      const src = $(el).find("img.face").attr("src") ?? "";
      if (src.startsWith("http")) {
        photoUrl = src.split("?")[0];
      }

      players.push({ name, probabilityPct, position, photoUrl });
    });

  return players;
}

/** Mapea el número de fila del campo (linea-N) a nuestra posición. */
function mapLineaToPosition(linea: number | undefined): Position | null {
  switch (linea) {
    case 1:
      return "POR";
    case 2:
      return "DEF";
    case 3:
      return "MED";
    case 4:
    case 5:
      return "DEL";
    default:
      return null;
  }
}

/** Parsea las bajas (fifa-cards) del bloque #unavailable de un equipo. */
function parseUnavailable($: cheerio.CheerioAPI, scope: Element | undefined): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  if (!scope) return events;

  $(scope)
    .find("a.fifa-card")
    .each((_, card) => {
      const name = cleanText($(card).find("img.face").attr("alt") ?? "");
      const name2 = $(card).find("span.name").first().text().trim();
      const playerName = name.replace(/^Cara de\s+/i, "") || name2 || "";
      if (!playerName || seen.has(playerName)) return;
      seen.add(playerName);

      const reason = $(card).find(".status").attr("title") ?? "";
      const estado = $(card).find("span.capitalize.text").text().trim();
      const statusCls = $(card).find(".status img").attr("class") ?? "";

      let eventType: EventType;
      let severity: Severity;
      if (/lesion/i.test(statusCls) || /lesion/i.test(estado)) {
        eventType = "injury";
        severity = "moderate";
      } else if (/doubt/i.test(statusCls) || /du[aá]/i.test(estado)) {
        eventType = "doubt";
        severity = "none";
      } else if (/sanci/i.test(statusCls) || /sanci/i.test(estado)) {
        eventType = "suspension";
        severity = "moderate";
      } else {
        eventType = "injury";
        severity = "light";
      }

      events.push({
        playerName,
        eventType,
        severity,
        reason: reason || estado || null,
        note: `Estado: ${estado || "no disponible"} (fuente JornadaPerfecta).`,
      });
    });

  return events;
}

export type { Severity };
