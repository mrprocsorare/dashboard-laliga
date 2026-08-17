/**
 * Matching CERRADO contra el roster canónico de un equipo.
 *
 * El matcher NO usa heurísticas abiertas ni aliases: el roster ya es la
 * fuente de verdad (lista cerrada de 20-25 jugadores por equipo). Solo
 * comparamos el nombre scrapeado contra los nombres literales del roster
 * con reglas conservadoras.
 *
 * Estrategia (de más estricto a más laxo):
 *  1. Igualdad exacta normalizada.
 *  2. Subset inverso: el nombre scrapeado está COMPLETO dentro del canónico
 *     (ej. "Lookman" ⊂ "Ademola Lookman", "Balde" ⊂ "Alejandro Balde").
 *  3. Subset canónico: el nombre scrapeado CONTIENE el canónico (p. ej. el
 *     scraper añadió un segundo apellido).
 *  4. Apellido único: el scrapeado es 1 solo token y coincide con el ÚLTIMO
 *     token (apellido) de EXACTAMENTE UN jugador del roster.
 *
 * Devuelve siempre el match con mayor `confidence` (entre 0 y 1).
 */
import { normalizeName, significantTokens } from "../services/player-names";
import type { CanonicalPlayer } from "./roster";

export interface RosterMatch {
  index: number;
  confidence: number;
  rule: "exact" | "subset-canon" | "subset-inverse" | "last-name-unique";
}

export interface RosterMatcherOptions {
  /**
   * Umbral mínimo de confianza para considerar un match como válido.
   * Por debajo de este umbral, el forecast va a `unmatched_forecasts`.
   * Default 0.6.
   */
  minConfidence?: number;
}

export function matchAgainstRoster(
  raw: string,
  roster: CanonicalPlayer[],
  opts: RosterMatcherOptions = {},
): RosterMatch | null {
  const min = opts.minConfidence ?? 0.6;
  const incNorm = normalizeName(raw);
  const incTokens = significantTokens(raw);

  // Regla 4 (PRIMERO si entrante es 1 token): apellido único. Si hay
  // AMBIGÜEDAD (2+ jugadores con ese apellido), se rechaza el match aquí
  // para que las reglas más laxas (subset-inverse) no produzcan falsos
  // positivos contra el primero de la lista.
  if (incTokens.length === 1) {
    const incomingLast = incTokens[0];
    const candidates: number[] = [];
    for (let i = 0; i < roster.length; i++) {
      const canonTokens = significantTokens(roster[i].name);
      const last = canonTokens[canonTokens.length - 1];
      if (last === incomingLast) candidates.push(i);
    }
    if (candidates.length === 1) {
      const m: RosterMatch = {
        index: candidates[0],
        confidence: 0.75,
        rule: "last-name-unique",
      };
      if (m.confidence >= min) return m;
      return null;
    }
    if (candidates.length > 1) {
      return null; // Williams, García, etc.: AMBIGÜEDAD, rechazar.
    }
    // Si 0 candidatos, caemos al subset-inverse (caso de "García" si ningún
    // García está en el roster, debería dar null también por Regla 1/2/3).
  }

  let best: RosterMatch | null = null;

  for (let i = 0; i < roster.length; i++) {
    const canon = roster[i];
    const canonNorm = normalizeName(canon.name);
    const canonTokens = significantTokens(canon.name);

    // Regla 1: igualdad exacta normalizada.
    if (incNorm && incNorm === canonNorm) {
      return { index: i, confidence: 1.0, rule: "exact" };
    }

    if (incTokens.length >= 1 && canonTokens.length >= 1) {
      const canonSet = new Set(canonTokens);
      const incSet = new Set(incTokens);

      // Regla 2: subset inverso (entrante ⊂ canónico). "Lookman" → "Ademola Lookman".
      const inverseOK = incTokens.every((t) => canonSet.has(t));
      if (inverseOK) {
        const confidence = 0.7 + 0.2 * (incTokens.length / canonTokens.length);
        const m: RosterMatch = { index: i, confidence, rule: "subset-inverse" };
        if (m.confidence >= min && (!best || m.confidence > best.confidence)) {
          best = m;
          if (m.confidence >= 0.9) return m;
        }
      }

      // Regla 3: subset canónico (canónico ⊂ entrante).
      const canonLast = canonTokens[canonTokens.length - 1];
      if (canonLast && incSet.has(canonLast) && canonTokens.length <= incTokens.length) {
        const canonOK = canonTokens.every((t) => incSet.has(t));
        if (canonOK) {
          const m: RosterMatch = { index: i, confidence: 0.85, rule: "subset-canon" };
          if (m.confidence >= min && (!best || m.confidence > best.confidence)) {
            best = m;
            if (m.confidence >= 0.9) return m;
          }
        }
      }
    }
  }

  return best;
}
