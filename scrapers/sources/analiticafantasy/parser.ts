import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { ParseError } from "../../errors";
import type { Position, EventType, Severity } from "../../types";
import { analiticaConfig } from "./config";

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

/** Normaliza el nombre de equipo AF → clave del mapeo (minúsculas, sin tildes). */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Resuelve un nombre de equipo de AF a su slug canónico, o null si no se conoce. */
export function resolveTeamName(name: string): string | null {
  const key = normalizeTeamName(name);
  return (analiticaConfig.teamNameToSlug as Record<string, string>)[key] ?? null;
}

/**
 * Extrae del JSON-LD de la página de jornada el ItemList con los partidos
 * (solo los que ya tienen once publicado).
 */
export function parseMatchIndex(html: string): ParsedMatch[] {
  const $ = cheerio.load(html);
  const matches: ParsedMatch[] = [];
  const seen = new Set<string>();

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() ?? "";
    if (!raw.includes("ItemList") || !raw.includes("/partido/")) return;

    let data: unknown;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      return;
    }

    interface LdItem {
      url?: string;
      item?: {
        url?: string;
        name?: string;
      };
    }
    interface LdList {
      "@type"?: string;
      itemListElement?: LdItem[];
    }

    const list = (
      Array.isArray(data) ? (data as Array<LdList & Record<string, unknown>>).find((x) => x?.["@type"] === "ItemList") : data
    ) as LdList | null;

    for (const item of list?.itemListElement ?? []) {
      const url: string = item?.url ?? item?.item?.url ?? "";
      const name: string = item?.item?.name ?? "";
      if (!url.startsWith("https://www.analiticafantasy.com/partido/")) continue;

      const [localName, visitanteName] = String(name).split(/\s+vs\.?\s+/i);
      const local = resolveTeamName(localName ?? "");
      const visitante = resolveTeamName(visitanteName ?? "");
      if (!local || !visitante) continue;

      const id = url.replace(/^https:\/\/www\.analiticafantasy\.com\/partido\//, "");
      if (seen.has(id)) return;
      seen.add(id);

      matches.push({
        matchUrl: `/partido/${id}`,
        local,
        visitante,
      });
    }
  });

  if (matches.length === 0) {
    throw new ParseError("No se encontraron partidos en el JSON-LD de la jornada.");
  }
  return matches;
}

/**
 * Parsea la página de partido. El grid de dos columnas contiene, por cada
 * equipo, su campo (`[data-lineup-field]`) y su propio parte médico (h3).
 * Columna 0 = local, columna 1 = visitante.
 */
export function parseMatchPage(
  html: string,
): { [key: string]: ParsedTeamBlock } {
  const $ = cheerio.load(html);
  const result: { [key: string]: ParsedTeamBlock } = {
    local: { players: [], events: [] },
    visitante: { players: [], events: [] },
  };

  // Grid que contiene los onces (dos columnas con data-lineup-export-root).
  const grid = $("[data-lineup-export-root]").first().closest("[class*='md:grid-cols-2']");
  const columns = grid.length ? grid.children().toArray() : [];

  const sides: Array<"local" | "visitante"> = ["local", "visitante"];
  if (columns.length >= 2) {
    columns.forEach((col, idx) => {
      const side = sides[idx] ?? sides[sides.length - 1];
      const field = $(col).find("[data-lineup-field]").first();
      const block = result[side];
      if (field.length) {
        block.players = parsePlayers($, field.get(0));
      }
      block.events = parseMedicalReport($, col);
    });
  } else {
    // Sin onces: solo parte médico global.
    result.local.events = parseMedicalReport($, $("body").get(0));
  }

  return result;
}

/** Parsea los jugadores del once dentro de un `[data-lineup-field]`. */
function parsePlayers($: cheerio.CheerioAPI, field: Element | undefined): ParsedPlayer[] {
  const players: ParsedPlayer[] = [];
  const seen = new Set<string>();

  if (!field) return players;
  $(field).find('img[alt^="Foto de"]').each((_, el) => {
    const alt = $(el).attr("alt") ?? "";
    const name = cleanText(alt.replace(/^Foto de\s+/i, ""));
    if (!name || seen.has(name)) return;
    seen.add(name);

    // % de titularidad: badge tabular-nums del bloque del jugador.
    const badge = $(el).closest(".relative").find(".tabular-nums").first();
    const badgeText = cleanText(badge.text());
    const pctMatch = badgeText.match(/(\d+)/);
    const probabilityPct = pctMatch ? parseInt(pctMatch[1], 10) : 100;

    // AF no expone posición como dato (solo posición visual).
    const position: Position | null = null;

    // Foto.
    let photoUrl: string | null = null;
    const src = $(el).attr("src") ?? "";
    if (src.startsWith("http")) {
      photoUrl = src.split("?")[0];
    }

    players.push({ name, probabilityPct, position, photoUrl });
  });

  return players;
}

/**
 * Parsea el parte médico de un contenedor de equipo: secciones h3
 * "Jugadores en Duda (N)" y "Jugadores Lesionados (N)".
 */
function parseMedicalReport($: cheerio.CheerioAPI, container: Element | undefined): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  if (!container) return events;
  $(container).find("h3").each((_, el) => {
      const header = cleanText($(el).text());
      const isDuda = /en Duda/i.test(header);
      const isLesionado = /Lesionados/i.test(header);
      if (!isDuda && !isLesionado) return;

      const card = $(el).closest("div[class*='rounded-lg']");
      card.find('a[href^="/jugadores/"]').each((_, a) => {
        const name = cleanText($(a).find("span.truncate").first().text());
        if (!name) return;

        // Descripción extraída de los párrafos del bloque.
        const desc = cleanText(
          $(a)
            .find("p")
            .map((_, p) => $(p).text())
            .get()
            .join(" | "),
        );

        if (isLesionado) {
          if (seen.has(`les:${name}`)) return;
          seen.add(`les:${name}`);
          events.push({
            playerName: name,
            eventType: "injury",
            severity: "light",
            reason: desc || null,
            note: "Lesionado (fuente Analítica Fantasy).",
          });
        } else {
          if (seen.has(`duda:${name}`)) return;
          seen.add(`duda:${name}`);
          events.push({
            playerName: name,
            eventType: "doubt",
            severity: "none",
            reason: desc || null,
            note: "Duda para el partido (fuente Analítica Fantasy).",
          });
        }
      });
    });

  return events;
}

export type { Severity };
