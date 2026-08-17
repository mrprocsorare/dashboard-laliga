import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { ParseError } from "../../errors";
import type { Position, EventType, Severity } from "../../types";
import { biwengerConfig } from "./config";

/** Un partido de la jornada con sus dos slugs canónicos. */
export interface ParsedMatch {
  matchUrl: string;
  local: string;
  visitante: string;
}

/** Jugador del once publicado. */
export interface ParsedLineupPlayer {
  name: string;
  position: Position;
  photoUrl: string | null;
}

/** Jugador no disponible (lesionado, sancionado, duda…). */
export interface ParsedUnavailable {
  name: string;
  eventType: EventType;
  severity: Severity;
  reason: string | null;
  note: string | null;
}

/** Bloque completo de un equipo dentro del partido. */
export interface ParsedTeamBlock {
  teamSlug: string;
  players: ParsedLineupPlayer[];
  events: ParsedUnavailable[];
}

const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

/** Normaliza un nombre de equipo (sin tildes, minúsculas) para el mapeo. */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Resuelve un nombre de equipo (heading de Biwenger) a slug canónico. */
export function resolveTeamName(name: string): string | null {
  const key = normalizeTeamName(name);
  return (
    (biwengerConfig.teamNameToSlug as Record<string, string>)[key] ?? null
  );
}

/**
 * Extrae del índice de jornada los partidos con onces publicados.
 * Los enlaces tienen la forma /blog/partidos/{temporada}/jornada-{n}/{slug}-{slug}-{id}/
 */
export function parseMatchIndex(html: string): ParsedMatch[] {
  const $ = cheerio.load(html);
  const matches: ParsedMatch[] = [];
  const seen = new Set<string>();
  const season = biwengerConfig.season; // segmento de URL: "2026-2027"

  $(`a[href*="/blog/partidos/${season}/"]`).each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/blog\/partidos\/[^/]+\/[^/]+\/(.+)\/?$/);
    if (!m) return;
    const tail = m[1].replace(/\/$/, "");

    // Separar el id final (dígitos) del resto.
    const idMatch = tail.match(/^(.*)-(\d+)$/);
    if (!idMatch) return;
    const teamsPart = idMatch[1];

    // Encontrar el punto de corte donde ambas mitades son slugs conocidos.
    const parts = teamsPart.split("-");
    let resolved: { local: string; visitante: string } | null = null;
    for (let i = 1; i < parts.length; i++) {
      const left = parts.slice(0, i).join("-");
      const right = parts.slice(i).join("-");
      const local = (biwengerConfig.biwengerSlugToCanonical as Record<string, string>)[left];
      const visitante = (biwengerConfig.biwengerSlugToCanonical as Record<string, string>)[right];
      if (local && visitante) {
        resolved = { local, visitante };
        break;
      }
    }
    if (!resolved) return;
    const id = idMatch[2];
    if (seen.has(id)) return;
    seen.add(id);

    matches.push({
      matchUrl: href,
      local: resolved.local,
      visitante: resolved.visitante,
    });
  });

  if (matches.length === 0) {
    throw new ParseError("No se encontraron partidos en el índice de Biwenger.");
  }
  return matches;
}

/**
 * Parsea la página de partido. Devuelve los dos bloques de equipo (once +
 * no disponibles) identificados por slug canónico. Si un equipo no aparece
 * (p. ej. la fuente aún no ha publicado su once), su bloque queda vacío.
 */
export function parseMatchPage(html: string): {
  local: ParsedTeamBlock | null;
  visitante: ParsedTeamBlock | null;
} {
  const $ = cheerio.load(html);

  // Biwenger replaced the old `div.field.football` lineup markup with a
  // two-column `match-team-inner` grid. Prefer the current schema.org markup,
  // while retaining the old parser as a fallback for cached/older pages.
  const current = parseCurrentMatchPage($);
  if (current.local || current.visitante) return current;

  const blocks: ParsedTeamBlock[] = [];

  // Cada equipo tiene un `div.field.football` precedido por un heading
  // "Posible Alineación del {Equipo}".
  $("div.field.football").each((_, field) => {
    const heading = $(field)
      .prevAll("h2,h3,h4")
      .first()
      .text()
      .trim();
    const teamMatch = heading.match(/del\s+(.+)$/i);
    const teamName = teamMatch ? teamMatch[1] : heading;
    const teamSlug = resolveTeamName(teamName);
    if (!teamSlug) return;

    const players = parseFieldPlayers($, field);
    blocks.push({ teamSlug, players, events: [] });
  });

  // No disponibles: un único bloque "No disponibles" con dos columnas
  // (una por equipo), cada una con <h5>{Equipo}</h5> y la lista de jugadores.
  $("h2,h3,h4").each((_, el) => {
    if (!/no disponibles/i.test($(el).text())) return;
    const container = $(el).next();
    container.find("h5").each((_, h5) => {
      const teamName = $(h5).text().trim();
      const teamSlug = resolveTeamName(teamName);
      if (!teamSlug) return;
      const col = $(h5).closest(".col-sm-6, .col").first();
      const events = parseUnavailable($, col.get(0) as unknown as Element);
      const block = blocks.find((b) => b.teamSlug === teamSlug);
      if (block) block.events = events;
      else blocks.push({ teamSlug, players: [], events });
    });
  });

  // Local/visitante: el orden de los bloques es el de la página (local primero).
  let local: ParsedTeamBlock | null = null;
  let visitante: ParsedTeamBlock | null = null;
  if (blocks.length >= 1) local = blocks[0];
  if (blocks.length >= 2) visitante = blocks[1];

  return { local, visitante };
}

/** Parse the current Biwenger match layout (one local and one visitor per row). */
function parseCurrentMatchPage($: cheerio.CheerioAPI): {
  local: ParsedTeamBlock | null;
  visitante: ParsedTeamBlock | null;
} {
  const homeName = cleanText($("#main [itemprop=homeTeam] [itemprop=name]").first().text());
  const awayName = cleanText($("#main [itemprop=awayTeam] [itemprop=name]").first().text());
  const localSlug = resolveTeamName(homeName);
  const visitanteSlug = resolveTeamName(awayName);
  if (!localSlug || !visitanteSlug) return { local: null, visitante: null };

  const localPlayers: ParsedLineupPlayer[] = [];
  const visitantePlayers: ParsedLineupPlayer[] = [];
  const seenLocal = new Set<string>();
  const seenVisitante = new Set<string>();

  $("#team .match-team-inner").each((_, row) => {
    const performers = $(row).children('[itemprop="performer"]');
    if (performers.length < 2) return;

    const localPlayer = parseCurrentPlayer($, performers.eq(0));
    const visitantePlayer = parseCurrentPlayer($, performers.eq(1));
    if (localPlayer && !seenLocal.has(localPlayer.name)) {
      seenLocal.add(localPlayer.name);
      localPlayers.push(localPlayer);
    }
    if (visitantePlayer && !seenVisitante.has(visitantePlayer.name)) {
      seenVisitante.add(visitantePlayer.name);
      visitantePlayers.push(visitantePlayer);
    }
  });

  if (!localPlayers.length && !visitantePlayers.length) {
    return { local: null, visitante: null };
  }

  return {
    local: { teamSlug: localSlug, players: localPlayers, events: [] },
    visitante: { teamSlug: visitanteSlug, players: visitantePlayers, events: [] },
  };
}

/** Parse one current-layout `itemprop=performer` player card. */
function parseCurrentPlayer(
  $: cheerio.CheerioAPI,
  performer: cheerio.Cheerio<Element>,
): ParsedLineupPlayer | null {
  const name = cleanText(performer.find('h4[itemprop="name"]').first().text());
  if (!name) return null;

  const positionTitle = cleanText(performer.find(".player-position").first().attr("title") ?? "");
  const position = currentPosition(positionTitle);
  const src = performer.find('img[itemprop="image"]').first().attr("src") ?? "";

  return {
    name,
    position,
    photoUrl: src.startsWith("http") ? src.split("?")[0] : null,
  };
}

function currentPosition(title: string): Position {
  const normalized = normalizeTeamName(title);
  if (/port|goalkeeper|arquero|keeper/.test(normalized)) return "POR";
  if (/defen|defender|lateral|central/.test(normalized)) return "DEF";
  if (/medio|midfielder|mediocamp|interior|pivote/.test(normalized)) return "MED";
  return "DEL";
}

/** Parsea los jugadores del once dentro de un `div.field.football`. */
function parseFieldPlayers(
  $: cheerio.CheerioAPI,
  field: Element,
): ParsedLineupPlayer[] {
  const players: ParsedLineupPlayer[] = [];
  const seen = new Set<string>();

  const rows = $(field).children().toArray();
  const length = rows.length;

  $(field)
    .children()
    .each((i, row) => {
      const position = rowPosition(i, length);
      $(row)
        .find('a[href*="/blog/jugadores/"]')
        .each((_, a) => {
          const $a = $(a);
          // El nombre puede estar en title, en div[itemprop=name], o en el texto.
          const name = cleanText(
            $a.attr("title") ||
              $a.find("div[itemprop=name]").first().text() ||
              $a.find("div").first().text() ||
              $a.text(),
          );
          if (!name || seen.has(name)) return;
          seen.add(name);

          const src = $a.find("img").first().attr("src") ?? "";
          const photoUrl = src.startsWith("http") ? src.split("?")[0] : null;

          players.push({ name, position, photoUrl });
        });
    });

  return players;
}

/** Mapea el índice de fila (0 = arriba/ataque) a posición por su distancia al
 *  portero (última fila). */
function rowPosition(i: number, length: number): Position {
  if (i === length - 1) return "POR";
  if (i === length - 2) return "DEF";
  if (i === 0) return "DEL";
  return "MED";
}

/** Parsea los jugadores no disponibles de una columna de equipo. */
function parseUnavailable(
  $: cheerio.CheerioAPI,
  container: Element | undefined,
): ParsedUnavailable[] {
  const events: ParsedUnavailable[] = [];
  if (!container) return events;

  $(container)
    .find('div[itemprop="athlete"]')
    .each((_, row) => {
      const $row = $(row);
      const $a = $row.find('a[href*="/blog/jugadores/"]').first();
      const name = cleanText(
        $a.attr("title") || $a.find("div[itemprop=name]").first().text() || $a.text(),
      );
      if (!name) return;

      const rowText = cleanText($row.text());
      const { eventType, severity, label } = classifyStatus(rowText);

      events.push({
        name,
        eventType,
        severity,
        reason: label,
        note: `${label} (fuente Biwenger).`,
      });
    });

  return events;
}

/** Clasifica el estado a partir del texto de la fila del jugador. */
function classifyStatus(text: string): {
  eventType: EventType;
  severity: Severity;
  label: string;
} {
  if (/sancion/i.test(text)) {
    return { eventType: "suspension", severity: "moderate", label: "Sancionado" };
  }
  if (/lesion/i.test(text)) {
    return { eventType: "injury", severity: "moderate", label: "Lesionado" };
  }
  if (/descartad/i.test(text)) {
    return { eventType: "doubt", severity: "none", label: "Descartado" };
  }
  if (/duda/i.test(text)) {
    return { eventType: "doubt", severity: "none", label: "Duda" };
  }
  return { eventType: "doubt", severity: "none", label: "No disponible" };
}
