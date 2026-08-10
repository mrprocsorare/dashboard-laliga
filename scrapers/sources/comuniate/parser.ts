import * as cheerio from "cheerio";
import type { Position } from "../../types";
import { comuniateConfig } from "./config";
import { ParseError } from "../../errors";

export interface ParsedLineupPlayer {
  name: string;
  position: Position;
  /** Probabilidad de titularidad tal cual la publica la fuente (0-100) o null. */
  probabilityPct: number | null;
  /** True si la fuente marca duda de titularidad. */
  doubt: boolean;
  /** True si la fuente marca molestias/lesión leve. */
  injury: boolean;
  /** Jugador alternativo que entraría en su lugar. */
  alternative: string | null;
  photoUrl: string | null;
}

export interface FixtureIndex {
  /** Número de jornada ("JORNADA 1" → 1). */
  jornada: number;
}

/** Del índice de jornada extraemos el número de jornada actual. */
export function parseFixtureIndex(html: string): FixtureIndex {
  const $ = cheerio.load(html);
  const haystack =
    `${$("h1").text()} ${$(".alineaciones-stage-title").text()}`;
  const match = haystack.match(/jornada\s*(\d+)/i);
  if (!match) {
    throw new ParseError("No se encontró el número de jornada en el índice.");
  }
  return { jornada: parseInt(match[1], 10) };
}

/** Parsea la respuesta del endpoint AJAX de alineación (`pintar_alineacion.php`). */
export function parseLineup(html: string): ParsedLineupPlayer[] {
  const $ = cheerio.load(html);
  const players: ParsedLineupPlayer[] = [];

  for (const [sectionId, position] of Object.entries(
    comuniateConfig.positionSections,
  )) {
    const blocks = $(`#${sectionId} .jugador.jugador_campo`);

    blocks.each((_, el) => {
      const nameEl = $(".nombre_jugador", el).first();
      const name = nameEl.text().trim().replace(/\s+/g, " ");
      if (!name) return;

      const imgSrc = $(".cara_jugador img", el).first().attr("src") ?? "";
      const photoUrl = imgSrc.startsWith("http")
        ? imgSrc
        : `https://www.comuniate.com${imgSrc}` || null;

      const pctText = $(".icono_porcentaje", el).first().text().trim();
      const probabilityPct = pctText
        ? parseInt(pctText.replace(/[^0-9]/g, ""), 10) ?? null
        : null;

      players.push({
        name,
        position,
        probabilityPct,
        doubt: $(el).find(".duda").length > 0,
        injury: $(el).find("i.fa-plus").length > 0,
        alternative: $(".alternativo", el).first().text().trim() || null,
        photoUrl,
      });
    });
  }

  if (players.length === 0) {
    throw new ParseError("La respuesta de la alineación no contenía jugadores.");
  }

  return players;
}