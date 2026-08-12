import * as cheerio from "cheerio";
import { ParseError } from "../../errors";
import type { Position, EventType, Severity } from "../../types";
import {
  futbolfantasyConfig,
  FF_TEAM_SLUGS_BY_LENGTH,
  type FutbolFantasyTeamSlug,
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

/**
 * Resuelve el tail de una URL de partido (`{local}-{visitante}`, donde cada
 * slug puede contener guiones) en los dos slugs canónicos.
 * Ej: "real-madrid-real-sociedad" → { local: "real-madrid", visitante: "real-sociedad" }.
 */
export function resolveMatchSlugs(tail: string): ParsedMatch["local"] | null {
  const map = futbolfantasyConfig.teamSlugToCanonical;
  for (const a of FF_TEAM_SLUGS_BY_LENGTH) {
    if (tail === a) {
      return map[a as FutbolFantasyTeamSlug];
    }
    for (const b of FF_TEAM_SLUGS_BY_LENGTH) {
      if (tail === `${a}-${b}`) {
        return `${map[a as FutbolFantasyTeamSlug]}|${map[b as FutbolFantasyTeamSlug]}`;
      }
    }
  }
  return null;
}

/** Devuelve la lista de partidos de la jornada actual (enlaces `a.partido`). */
export function parseMatchIndex(html: string): ParsedMatch[] {
  const $ = cheerio.load(html);
  const matches: ParsedMatch[] = [];
  const seen = new Set<string>();

  // La jornada activa vive en la primera sección `proxjornada` (las otras
  // secciones contienen amistosos, previas de otras competiciones, etc.).
  const proxJornada = $("section.mod.proxjornada").first();
  proxJornada.find("a.partido").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/partidos\/(\d+)-([a-z0-9-]+)$/);
    if (!m) return;
    const matchId = m[1];
    const tail = m[2];
    const resolved = resolveMatchSlugs(tail);
    if (!resolved) return;
    const [local, visitante] = resolved.split("|");
    if (!local || !visitante || seen.has(matchId)) return;
    seen.add(matchId);
    matches.push({ matchUrl: href, local, visitante });
  });

  if (matches.length === 0) {
    throw new ParseError("No se encontraron partidos de LaLiga en el índice.");
  }
  return matches;
}

/**
 * Extrae de la página de un partido el once probable de cada equipo, sus
 * suplentes y los módulos de lesionados/sancionados.
 * Recibe `local`/`visitante` (slugs canónicos) ya resueltos.
 */
export function parseMatchPage(
  html: string,
  local: string,
  visitante: string,
): { [key: string]: ParsedTeamBlock } {
  const $ = cheerio.load(html);

  return {
    local: parseTeam($, local, "local"),
    visitante: parseTeam($, visitante, "visitante"),
  };
}

/** Parsea el bloque de un equipo: once probable + suplentes + bajas/sanciones. */
function parseTeam($: cheerio.CheerioAPI, slug: string, side: "local" | "visitante"): ParsedTeamBlock {
  const players: ParsedPlayer[] = [];
  const seen = new Set<string>();

  // Selector base del wrapper del once de este lado.
  const wrapper = $(`.campo-wrapper.${side} .camiseta-wrapper`);

  wrapper.each((_, el) => {
    const once = $(el).attr("data-onceFF") ?? "";
    // Solo nos interesan los del once probable (titular) y alternativas que
    // tengan probabilidad explícita. Los "suplente" sin % son banquillo puro.
    const pctAttr = $(el).find("a.camiseta").attr("data-probabilidad");
    if (once === "suplente" && !pctAttr) return;

    // Nombre completo del jugador (img alt), con fallback al apellido corto.
    const imgAlt = cleanText($(el).find(".fotocontainer img").first().attr("alt") ?? "");
    const shortName = cleanText($(el).find(".truncate-name").first().text());
    const name = imgAlt || shortName;
    if (!name || seen.has(name)) return;
    seen.add(name);

    const prob = parseInt(pctAttr?.replace(/[^0-9]/g, "") ?? "", 10);
    if (Number.isNaN(prob)) return;

    const hasPortero = $(el).hasClass("portero");
    const position: Position | null = hasPortero ? "POR" : null;

    const img = $(el).find(".fotocontainer img").first();
    let photoUrl: string | null = null;
    const dataSrc = img.attr("data-src") ?? "";
    if (dataSrc.startsWith("http")) {
      photoUrl = dataSrc.replace(/^\/\//, "https://");
    } else if (dataSrc) {
      photoUrl = `https:${dataSrc}`;
    }

    players.push({
      name,
      probabilityPct: prob,
      position,
      photoUrl,
    });
  });

  const events = [
    ...parseAbsences($, slug, side, "lesionado"),
    ...parseAbsences($, slug, side, "sancionado"),
  ];

  return { players, events };
}

/** Parsea los módulos "Lesionados del X" / "Sancionados del X" según cabecera. */
function parseAbsences(
  $: cheerio.CheerioAPI,
  slug: string,
  side: "local" | "visitante",
  kind: "lesionado" | "sancionado",
): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  // Las secciones combinan clases (`.mod lesionados sancionados …`); nos
  // guiarmos por la cabecera para decidir de qué bloque estamos hablando.
  const expectedHeader = kind === "lesionado" ? /Lesionados del/i : /Sancionados del/i;
  const itemCls = kind === "lesionado" ? ".elemento.lesionado" : ".elemento.sancionado";

  $(`section.mod.${side}`).each((_, sec) => {
    const header = cleanText($(sec).find("header").first().text());
    if (!expectedHeader.test(header)) return;

    $(sec).find(itemCls).each((_, el) => {
      const name = cleanText($(el).find(".jugador").first().text());
      if (!name) return;

      const reason = cleanText($(el).find(".lesion").first().text());
      const gravedadClass =
        $(el)
          .find("[class*='gravedad-']")
          .first()
          .attr("class")
          ?.match(/gravedad-(\d)/)?.[1] ?? "";

      if (kind === "lesionado") {
        const eventType: EventType = "injury";
        const severity: Severity =
          gravedadClass === "0" ? "out" : gravedadClass === "1" ? "light" : "moderate";
        events.push({
          playerName: name,
          eventType,
          severity,
          reason: reason || null,
          note:
            severity === "out"
              ? "Baja confirmada (fuente FutbolFantasy)."
              : "Lesión / duda (fuente FutbolFantasy).",
        });
      } else {
        const typeText = cleanText($(el).text());
        const isSuspension = /sancion|sanction|amarilla|tarjeta|acumulaci/i.test(typeText);
        events.push({
          playerName: name,
          eventType: isSuspension ? "suspension" : "transfer",
          severity: "moderate",
          reason: reason || null,
          note: "Sancionado (fuente FutbolFantasy).",
        });
      }
    });
  });

  return events;
}
