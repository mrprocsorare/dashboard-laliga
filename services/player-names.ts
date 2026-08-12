/**
 * Unificación de nombres de jugador entre fuentes.
 *
 * Cada fuente escribe los nombres a su manera ("Tenaglia", "Nahuel Tenaglia",
 * "A. Blanco", "Antonio Blanco"). Para que el consenso cruzado funcione hay que
 * resolver cuándo dos cadenas se refieren al MISMO jugador dentro de un equipo.
 *
 * Estrategia CONSERVADORA (elegida para no fusionar nunca dos jugadores
 * distintos que compartan apellido):
 *  - Normalizamos (minúsculas, sin acentos, sin puntuación).
 *  - Dos nombres son el mismo jugador si son idénticos normalizados, o si los
 *    tokens "significativos" (>= 2 letras, esto descarta iniciales sueltas) de
 *    uno son un SUBCONJUNTO de los del otro.
 *    Ej.: "Tenaglia" ⊂ "Nahuel Tenaglia"; "A. Blanco" → ["blanco"] ⊂ "Antonio Blanco".
 *  - Los casos ambiguos ("Á. Pérez Hidalgo" vs "Ángel Pérez") NO se fusionan:
 *    es preferible sub-unificar que fusionar por error.
 */

/** Minúsculas, sin acentos ni puntuación, espacios colapsados. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens de >= 2 letras (descarta iniciales sueltas como "a." o "k."). */
export function significantTokens(raw: string): string[] {
  return normalizeName(raw)
    .split(" ")
    .filter((t) => t.length >= 2);
}

/** ¿Se refieren dos nombres al mismo jugador (regla conservadora)? */
export function isSamePlayer(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  return isSubset(ta, tb) || isSubset(tb, ta);
}

/** ¿Están todos los tokens de `small` dentro de `big`? */
function isSubset(small: string[], big: string[]): boolean {
  const bigSet = new Set(big);
  return small.every((t) => bigSet.has(t));
}

/**
 * Devuelve el nombre "más completo" de dos variantes (la que tenga más tokens
 * significativos; a igualdad, la más larga). Sirve para quedarnos con la forma
 * canónica al fusionar.
 */
export function moreCompleteName(a: string, b: string): string {
  const ta = significantTokens(a).length;
  const tb = significantTokens(b).length;
  if (ta !== tb) return ta > tb ? a : b;
  return normalizeName(a).length >= normalizeName(b).length ? a : b;
}
