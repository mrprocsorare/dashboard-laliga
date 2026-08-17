/**
 * Matching en DOS FASES contra el roster canónico.
 *
 * El roster es la lista cerrada de jugadores del equipo (vía Wikipedia).
 * Antes de calcular una distancia global sobre el string completo, separamos
 * la comparación:
 *
 *  Fase 1 — APELLIDO: extraemos el último token (o últimos si es compuesto)
 *           del nombre scrapeado y del canónico. Si no coinciden, NO es
 *           match (independientemente del nombre de pila). Esto evita falsos
 *           positivos tipo "García" ↔ "García 2".
 *
 *  Fase 2 — NOMBRE DE PILA: si los apellidos coinciden, comparamos el
 *           PRIMER token (o primeros N si es compuesto) por cualquiera de:
 *             (a) igualdad exacta,
 *             (b) uno es diminutivo/alias del otro vía tabla de diminutivos
 *                 (`lib/first-name-aliases.ts`),
 *             (c) abreviaturas de inicial ("P." = "Pedro").
 *           Si CUALQUIERA se cumple, es la misma persona.
 *
 * Esto resuelve el bug "Álex Grimaldo" vs "Alejandro Grimaldo" y cualquier
 * otro par (formal, diminutivo) que comparta apellido.
 *
 * Casos cubiertos (Reglas A–F):
 *  A. Igualdad exacta normalizada → confidence 1.0.
 *  B. Apellido único por equipo: el scrapeado es 1 solo token y es el
 *     ÚLTIMO token de EXACTAMENTE UN jugador del roster → confidence 0.85.
 *  C. Apellido + nombre de pila (con diminutivos) → confidence 0.95.
 *  D. Subset inverso de tokens (sin cambio de nombre de pila) → confidence
 *     0.7 + 0.2 * (incTokens/canonTokens).
 *  E. Subset canónico (el scraper añadió algo, p. ej. segundo apellido)
 *     → confidence 0.85.
 *  F. Apellido único ambiguo (2+ candidatos) → RECHAZO (evita el bug
 *     Williams/García).
 *
 * Devuelve el match con mayor confidence que supere `minConfidence`.
 */
import { normalizeName, significantTokens } from "../services/player-names";
import { sameFirstName } from "./first-name-aliases";
import type { CanonicalPlayer } from "./roster";

/**
 * Versión extendida de `significantTokens` que PRESERVA la inicial de 1
 * letra (p. ej. "P. Aubameyang" → ["p", "aubameyang"]). Usada por la regla
 * de iniciales en `sameFirstName`.
 */
function allTokens(raw: string): string[] {
  return normalizeName(raw).split(" ").filter(Boolean);
}

/**
 * Estima cuántos tokens finales del nombre forman el apellido. Detecta
 * partículas comunes ("de", "del", "la", "las", "los", "y") y devuelve
 * la longitud del apellido compuesto. Para nombres simples devuelve 1.
 */
const LAST_NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "san", "santa"]);

function guessLastNameLength(tokens: string[]): number {
  if (tokens.length <= 1) return tokens.length;
  // El apellido empieza en el primer token que NO es partícula (de, del, …).
  // Ej: "Iñigo Ruiz de Galarreta" → ["iñigo","ruiz","de","galarreta"]. Apellido
  // empieza en "ruiz" (índice 1) → longitud 3.
  // Ej: "Ruiz de Galarreta" → ["ruiz","de","galarreta"]. Apellido empieza
  // en "ruiz" (índice 0) → longitud 3.
  let firstLastIdx = tokens.length - 1;
  for (let i = tokens.length - 2; i >= 0; i--) {
    const t = tokens[i];
    if (!LAST_NAME_PARTICLES.has(t)) {
      firstLastIdx = i;
      break;
    }
    firstLastIdx = i;
  }
  return tokens.length - firstLastIdx;
}

export interface RosterMatch {
  index: number;
  confidence: number;
  rule:
    | "exact"
    | "last-name-unique"
    | "first-name-alias-same-lastname"
    | "subset-inverse"
    | "subset-canon";
}

export interface RosterMatcherOptions {
  /**
   * Umbral mínimo de confianza para considerar un match como válido.
   * Por debajo, el forecast va a `unmatched_forecasts`.
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

  // Helper: ¿el ÚLTIMO token (apellido) del scrapeado aparece como último
  // token (o como token final del bloque de apellido) en el canónico?
  const lastNameOf = (tokens: string[]): string => tokens[tokens.length - 1] ?? "";

  // Regla F: apellido único o ambiguo. Si el input es exactamente 1
  // token significativo (sin iniciales), aplicamos esta regla. Si tiene
  // 2 tokens donde el primero es 1 letra (inicial) y el segundo es
  // apellido, vamos a Regla C para que la inicial se compare como tal.
  const incAllRaw = allTokens(raw);
  if (incTokens.length === 1 && incAllRaw.length === 1) {
    const incomingLast = incTokens[0];
    const candidates: number[] = [];
    for (let i = 0; i < roster.length; i++) {
      const canonTokens = significantTokens(roster[i].name);
      const last = lastNameOf(canonTokens);
      if (last === incomingLast) candidates.push(i);
    }
    if (candidates.length === 1) {
      const m: RosterMatch = {
        index: candidates[0],
        confidence: 0.85,
        rule: "last-name-unique",
      };
      if (m.confidence >= min) return m;
      return null;
    }
    if (candidates.length > 1) return null;
  }

  let best: RosterMatch | null = null;

  for (let i = 0; i < roster.length; i++) {
    const canon = roster[i];
    const canonNorm = normalizeName(canon.name);
    const canonTokens = significantTokens(canon.name);

    // Regla A: igualdad exacta normalizada.
    if (incNorm && incNorm === canonNorm) {
      return { index: i, confidence: 1.0, rule: "exact" };
    }

    if (incTokens.length >= 1 && canonTokens.length >= 1) {
      const canonSet = new Set(canonTokens);
      const incSet = new Set(incTokens);

      // Regla D: subset inverso (todos los tokens del entrante están en
      // el canónico). "Lookman" → "Ademola Lookman".
      // IMPORTANTE: Regla D solo aplica si los nombres de pila son
      // "compatibles" (igual o diminutivo) O el entrante es 1 solo token.
      // Sin este filtro, "P. García" matchearía contra "Francisco García"
      // porque comparten apellido pero tienen distinto nombre de pila.
      const inverseOK = incTokens.every((t) => canonSet.has(t));
      const firstNamesCompatible =
        incAllRaw.length === 1 ||
        sameFirstName(incAllRaw[0] ?? "", canonTokens[0] ?? "");
      if (inverseOK && firstNamesCompatible) {
        const confidence = 0.7 + 0.2 * (incTokens.length / canonTokens.length);
        const m: RosterMatch = {
          index: i,
          confidence,
          rule: "subset-inverse",
        };
        if (m.confidence >= min && (!best || m.confidence > best.confidence)) {
          best = m;
          if (m.confidence >= 0.9) return m;
        }
      }

      // Regla E: subset canónico (todos los tokens del canónico están en
      // el entrante). El scraper añadió un segundo apellido o más detalle.
      const canonLast = canonTokens[canonTokens.length - 1];
      if (canonLast && incSet.has(canonLast) && canonTokens.length <= incTokens.length) {
        const canonOK = canonTokens.every((t) => incSet.has(t));
        if (canonOK) {
          const m: RosterMatch = {
            index: i,
            confidence: 0.85,
            rule: "subset-canon",
          };
          if (m.confidence >= min && (!best || m.confidence > best.confidence)) {
            best = m;
            if (m.confidence >= 0.9) return m;
          }
        }
      }

      // Regla C: APELLIDO + NOMBRE DE PILA (con tabla de diminutivos).
      // Esta es la pieza que faltaba. Requisito: ambos nombres tienen al
      // menos 2 tokens (nombre + apellido); el último token de cada uno
      // (el apellido) coincide; el primer token (nombre de pila) coincide
      // por igualdad, alias/diminutivo, o inicial.
      // Usamos `allTokens` (no `significantTokens`) para preservar la
      // inicial "P." que `significantTokens` filtraría por longitud < 2.
      if (incAllRaw.length >= 2 && canonTokens.length >= 2) {
        const incLast = incAllRaw[incAllRaw.length - 1];
        const canonLast = canonTokens[canonTokens.length - 1];
        if (incLast === canonLast) {
          if (sameFirstName(incAllRaw[0], canonTokens[0])) {
            const m: RosterMatch = {
              index: i,
              confidence: 0.95,
              rule: "first-name-alias-same-lastname",
            };
            if (m.confidence >= min && (!best || m.confidence > best.confidence)) {
              best = m;
              return m;
            }
          }
        }
      }

      // Regla C2: APELLIDO COMPUESTO. Si el canónico tiene apellido
      // compuesto (≥2 tokens al final: "Ruiz de Galarreta"), y el input
      // termina en esos mismos N tokens, es la misma persona — no hace
      // falta comparar el nombre de pila. Esto cubre "Ruiz de Galarreta"
      // → "Iñigo Ruiz de Galarreta".
      const canonLastNameLen = guessLastNameLength(canonTokens);
      if (
        canonLastNameLen >= 2 &&
        incTokens.length >= canonLastNameLen &&
        canonLastNameLen < canonTokens.length
      ) {
        const incLast = incTokens.slice(-canonLastNameLen);
        const canonLast = canonTokens.slice(-canonLastNameLen);
        if (incLast.every((t, k) => t === canonLast[k])) {
          const m: RosterMatch = {
            index: i,
            confidence: 0.9,
            rule: "first-name-alias-same-lastname",
          };
          if (m.confidence >= min && (!best || m.confidence > best.confidence)) {
            best = m;
            return m;
          }
        }
      }
    }
  }

  return best;
}

/**
 * Score "raw" (sin aplicar minConfidence) usado por el auditor de
 * "near-misses". Devuelve un objeto con la confidence y la regla si hay
 * algún candidato, o null si no. Sirve para detectar pares que están en
 * una zona intermedia y requieren revisión manual.
 */
export interface NearMiss {
  index: number;
  canonicalName: string;
  rawName: string;
  confidence: number;
  rule: RosterMatch["rule"];
}

export function nearMisses(
  raw: string,
  roster: CanonicalPlayer[],
): NearMiss[] {
  const incNorm = normalizeName(raw);
  const incTokens = significantTokens(raw);
  const matches: NearMiss[] = [];

  for (let i = 0; i < roster.length; i++) {
    const canon = roster[i];
    const canonNorm = normalizeName(canon.name);
    const canonTokens = significantTokens(canon.name);

    let confidence = 0;
    let rule: RosterMatch["rule"] | null = null;

    if (incNorm && incNorm === canonNorm) {
      confidence = 1.0;
      rule = "exact";
    } else if (incTokens.length === 1 && canonTokens.length >= 2) {
      const last = canonTokens[canonTokens.length - 1];
      if (last === incTokens[0]) {
        confidence = 0.85;
        rule = "last-name-unique";
      }
    } else if (
      incTokens.length >= 2 &&
      canonTokens.length >= 2 &&
      incTokens[incTokens.length - 1] === canonTokens[canonTokens.length - 1]
    ) {
      const incFirst = incTokens[0];
      const canonFirst = canonTokens[0];
      if (sameFirstName(incFirst, canonFirst)) {
        confidence = 0.95;
        rule = "first-name-alias-same-lastname";
      }
    } else if (incTokens.length >= 1 && canonTokens.length >= 1) {
      const canonSet = new Set(canonTokens);
      const inverseOK = incTokens.every((t) => canonSet.has(t));
      if (inverseOK) {
        confidence = 0.7 + 0.2 * (incTokens.length / canonTokens.length);
        rule = "subset-inverse";
      }
    }

    if (rule) {
      matches.push({
        index: i,
        canonicalName: canon.name,
        rawName: raw,
        confidence,
        rule,
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}
