import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { ParseError } from "../../errors";
import type { Position, EventType, Severity } from "../../types";
import { sportsGamblerConfig } from "./config";

/** Un partido con id de lineups y sus dos slugs canónicos. */
export interface ParsedMatch {
  matchId: string;
  local: string;
  visitante: string;
}

/** Jugador con su probabilidad de titularidad. */
export interface ParsedPlayer {
  name: string;
  probabilityPct: number;
  position: Position | null;
}

/** Evento de lesión/sanción declarado por la fuente. */
export interface ParsedEvent {
  playerName: string;
  eventType: EventType;
  severity: Severity;
  reason: string | null;
  note: string | null;
}

/** Bloque completo de un equipo dentro del once predicho. */
export interface ParsedTeamBlock {
  players: ParsedPlayer[];
}

const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

/** Normaliza un nombre de equipo SG → clave del mapeo (minúsculas, sin acentos). */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Resuelve un nombre de equipo de SG a su slug canónico, o null. */
export function resolveTeamName(name: string): string | null {
  const key = normalizeTeamName(name);
  return (sportsGamblerConfig.teamNameToSlug as Record<string, string>)[key] ?? null;
}

/**
 * Extrae de la página de lineups los partidos de LaLiga que ya tienen once
 * predicho publicado (los que tienen un `a.lineups-toggle-button[id]`).
 */
export function parseLineupIndex(html: string): ParsedMatch[] {
  const $ = cheerio.load(html);
  const matches: ParsedMatch[] = [];
  const seen = new Set<string>();

  $(".lineup-row").each((_, row) => {
    const id = $(row).find("a.lineups-toggle-button").attr("id") ?? "";
    if (!id) return;

    const league = cleanText($(row).find(".fxs-league").text());
    if (!/la liga/i.test(league)) return;

    const home = cleanText($(row).find(".fxs-team.home").text());
    const visitante = cleanText($(row).find(".fxs-team:not(.home)").first().text());

    const local = resolveTeamName(home);
    const vis = resolveTeamName(visitante);
    if (!local || !vis || seen.has(id)) return;
    seen.add(id);

    matches.push({ matchId: id, local, visitante: vis });
  });

  if (matches.length === 0) {
    throw new ParseError("No se encontraron partidos de LaLiga con onces publicados.");
  }
  return matches;
}

/**
 * Parsea el fragmento AJAX de lineups (dos onces: home y away).
 * Devuelve las alineaciones de ambos equipos.
 */
export function parseLineupFragment(
  html: string,
): { local: ParsedTeamBlock; visitante: ParsedTeamBlock } {
  const $ = cheerio.load(html);

  const local = parseSide($, $(".lineups-home").first());
  const visitante = parseSide($, $(".lineups-away").first());

  return { local, visitante };
}

/** Parsea los jugadores de un lado (home/away) del once predicho. */
function parseSide($: cheerio.CheerioAPI, side: cheerio.Cheerio<Element>): ParsedTeamBlock {
  const players: ParsedPlayer[] = [];
  const seen = new Set<string>();
  if (!side.length) return { players };

  // Formación de este lado (ej. "3-5-2") para inferir posiciones.
  const formation = cleanText(
    side.closest(".lineups-container").prev(".lineups-formation").find("h3").first().find(".lineups-toggle-formation").text(),
  );
  const formationParts = formation
    .split("-")
    .map((n) => parseInt(n, 10))
    .filter((n) => !Number.isNaN(n));

  let lineIndex = 0;
  side.find(".players-line").each((_, pl) => {
    const isGoalie = $(pl).hasClass("goalie");
    $(pl)
      .find(".player-name")
      .each((_, nameEl) => {
        const name = cleanText($(nameEl).text());
        if (!name || seen.has(name)) return;
        seen.add(name);

        let position: Position | null = null;
        if (isGoalie || lineIndex === 0) {
          position = "POR";
        } else {
          // Distribuimos las líneas restantes según la formación.
          const defCount = formationParts[0] ?? 4;
          if (lineIndex === 1) position = "DEF";
          else if (lineIndex === 2) position = "MED";
          else if (formationParts.length > 2 && lineIndex === 3) position = "DEL";
          else if (defCount === 0 && lineIndex === 1) position = "MED";
          else position = "DEL";
        }

        players.push({ name, probabilityPct: 100, position });
      });
    lineIndex += 1;
  });

  return { players };
}

/**
 * Parsea la página de lesiones: por equipo (div.injury-block), cada jugador
 * en div.inj-row con tipo (injury-plus/injury-questionmark/redcard).
 */
export function parseInjuries(html: string): Map<string, ParsedEvent[]> {
  const $ = cheerio.load(html);
  const result = new Map<string, ParsedEvent[]>();

  $(".injury-block").each((_, block) => {
    const teamSlug = $(block).find("h3.injuries-title").attr("id") ?? "";
    if (!teamSlug) return;
    if (!result.has(teamSlug)) result.set(teamSlug, []);

    // El slug de SG (id) usa guiones como los nuestros (atletico-madrid, etc.),
    // pero necesitamos emparejar con los nuestros.
    $(block)
      .find(".inj-row")
      .each((_, row) => {
        const name = cleanText($(row).find(".inj-player").text());
        if (!name) return;
        const typeCls = $(row).find(".inj-type").attr("class") ?? "";
        const info = cleanText($(row).find(".inj-info").text());

        let eventType: EventType;
        let severity: Severity;
        if (/redcard|suspension|yellow card|red card/i.test(typeCls + " " + info)) {
          eventType = "suspension";
          severity = "moderate";
        } else if (/injury-plus|injur/i.test(typeCls) || /km/i.test(info)) {
          eventType = "injury";
          severity = "moderate";
        } else if (/questionmark|other|doubt/i.test(typeCls + " " + info)) {
          // "injury-questionmark" suele ser lesión/duda menos grave.
          eventType = "injury";
          severity = "light";
        } else {
          eventType = "injury";
          severity = "light";
        }

        result.get(teamSlug)?.push({
          playerName: name,
          eventType,
          severity,
          reason: info || null,
          note: `Lesión/sanción (fuente SportsGambler).`,
        });
      });
  });

  return result;
}

export type { Severity };
