/**
 * Unificación de nombres de jugador entre fuentes.
 *
 * Cada fuente escribe los nombres a su manera ("Tenaglia", "Nahuel Tenaglia",
 * "A. Blanco", "Antonio Blanco"). Para que el consenso cruzado funcione hay que
 * resolver cuándo dos cadenas se refieren al MISMO jugador dentro de un equipo.
 *
 * Estrategia (de menor a mayor riesgo, aplicada en orden):
 *  1. Normalizamos (minúsculas, sin acentos, sin puntuación).
 *  2. Coincidencia exacta o por subset de tokens significativos
 *     (>=2 letras): "Tenaglia" ⊂ "Nahuel Tenaglia"; "A. Blanco" → ["blanco"]
 *     ⊂ "Antonio Blanco". Conservadora: bajo riesgo de falsos positivos.
 *  3. **Alias de primer nombre con mismo apellido**: si dos nombres comparten
 *     el último token (apellido) y sus primeros nombres resuelven al MISMO
 *     canónico en `FIRST_NAME_ALIASES` (mapa curado de diminutivos /
 *     variantes: Alejandro↔Álex, Javier↔Javi, Fernando↔Fer, Facundo↔Facu,
 *     Rodrigo↔Roro, Rubén↔Rubo, Youssef↔Yusi…), los consideramos la misma
 *     persona. Esta regla NUNCA se aplica si los primeros nombres NO
 *     resuelven al mismo canónico: por eso NO une a los hermanos Williams
 *     (Iñaki vs Nico) ni a Eric García vs Joan García.
 *  4. Casos ambiguos no se fusionan: preferimos sub-unificar a fusionar por
 *     error. Las diferencias de una letra en el apellido (Egiluz / Eguíluz)
 *     quedan como entradas separadas por seguridad.
 */

/**
 * Mapa curado de variantes del primer nombre → forma canónica. Solo incluimos
 * pares bien documentados en LaLiga; cualquier nuevo caso se añade aquí. Las
 * claves se almacenan ya normalizadas (minúsculas, sin acentos).
 */
const FIRST_NAME_ALIASES: Record<string, string> = {
  alejandro: "alejandro",
  alex: "alejandro",
  álex: "alejandro",
  javier: "javier",
  javi: "javier",
  fernando: "fernando",
  fer: "fernando",
  nando: "fernando",
  facundo: "facundo",
  facu: "facundo",
  rodrigo: "rodrigo",
  roro: "rodrigo",
  ruben: "ruben",
  rubo: "ruben",
  youssef: "youssef",
  yusi: "youssef",
  jose: "jose",
  pepe: "jose",
  francisco: "francisco",
  paco: "francisco",
  antonio: "antonio",
  toni: "antonio",
  rafael: "rafael",
  rafa: "rafael",
  rafaelo: "rafael",
  manuel: "manuel",
  manu: "manuel",
  jesus: "jesus",
  chus: "jesus",
};

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

/**
 * Devuelve el canónico del primer nombre (o el propio nombre si no está en el
 * mapa). Permite comparar dos primeras palabras en igualdad de condiciones.
 */
function firstNameCanonical(raw: string): string {
  const normalized = normalizeName(raw);
  return FIRST_NAME_ALIASES[normalized] ?? normalized;
}

/**
 * ¿Comparten apellido y ambos primeros nombres resuelven al mismo canónico?
 * Cubre los diminutivos del fútbol español (Álex/Alejandro, Javi/Javier…).
 *
 * Si uno de los nombres es de un solo token (típicamente solo el primer
 * nombre, p. ej. "Yusi"), exige que ese token resuelva al alias del primer
 * nombre del nombre más largo. Así se une "Yusi" con "Youssef Enríquez" sin
 * necesidad de que aparezca el apellido en el nombre corto.
 */
function sameLastNameAndAlias(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  // Caso A: ambos tienen al menos 2 tokens (primer nombre + apellido).
  if (ta.length >= 2 && tb.length >= 2) {
    const lastA = ta[ta.length - 1];
    const lastB = tb[tb.length - 1];
    if (lastA !== lastB) return false;
    const firstA = normalizeName(a).split(" ")[0] ?? "";
    const firstB = normalizeName(b).split(" ")[0] ?? "";
    if (!firstA || !firstB) return false;
    if (firstA === firstB) return true;
    return firstNameCanonical(firstA) === firstNameCanonical(firstB);
  }

  // Caso B: uno de los nombres es solo el primer nombre (1 token).
  // Entonces ese token debe resolver al alias del primer token del otro nombre.
  const single = ta.length === 1 ? ta[0] : tb.length === 1 ? tb[0] : null;
  const longerTokens = ta.length === 1 ? tb : ta;
  if (!single || longerTokens.length < 2) return false;
  const longerFirst = longerTokens[0];
  return firstNameCanonical(single) === firstNameCanonical(longerFirst);
}

/** ¿Se refieren dos nombres al mismo jugador? */
export function isSamePlayer(a: string, b: string): boolean {
  if (!a || !b) return false;

  // 1) Mismo apellido + alias de primer nombre (incluye nombres cortos tipo
  //    "Yusi" vs "Youssef Enríquez").
  if (sameLastNameAndAlias(a, b)) return true;

  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  // 2) Subset conservador (cubre abreviaturas tipo "A. Blanco" → "Antonio
  //    Blanco"). NO se aplica cuando uno de los nombres es de un solo token:
  //    un apellido suelto ("García") haría match con cualquier "X García" y
  //    mezclaría jugadores distintos del mismo equipo.
  if (ta.length === 1 || tb.length === 1) {
    // Solo aceptamos el caso de un token si matchea por alias de primer nombre
    // (ya cubierto arriba); si no, son jugadores distintos.
    return false;
  }

  return isSubset(ta, tb) || isSubset(tb, ta);
}

/**
 * Heurística adicional: muchos scrapers deportivos se refieren a un jugador
 * por su único apellido cuando este es inequívoco dentro del equipo ("Balde"
 * en lugar de "Alejandro Balde", "Williams" en lugar de "N. Williams"). Esto
 * lo aplica el orquestador tras verificar que el equipo no contiene a otro
 * jugador con el mismo apellido (evita falsos positivos entre hermanos
 * Williams o entre varios García del mismo equipo).
 */
export function isSameLastNameReference(
  shortName: string,
  longName: string,
  teamRosterNames: string[],
): boolean {
  if (!shortName || !longName) return false;
  const shortTokens = significantTokens(shortName);
  const longTokens = significantTokens(longName);
  if (shortTokens.length !== 1 || longTokens.length < 2) return false;

  // Aceptamos que el token corto sea el primer nombre (referencia por nombre
  // de pila, p. ej. "Yeray") o el apellido ("Balde"). Esto cubre tanto
  // jugadores conocidos por el primer nombre como los referidos solo por
  // apellido. El apellido se detecta porque aparece como ÚLTIMO token del
  // nombre largo.
  const short = shortTokens[0];
  const first = longTokens[0];
  const last = longTokens[longTokens.length - 1];
  if (short !== first && short !== last) return false;

  // Seguridad: solo aplicamos el merge si en el equipo hay UN único jugador
  // que contiene este token como nombre/apellido (así no unimos a los
  // hermanos Williams ni a varios García del mismo equipo).
  const sameCount = teamRosterNames.filter((n) => {
    const tokens = significantTokens(n);
    return tokens.includes(short);
  }).length;
  return sameCount <= 1;
}

/** ¿Están todos los tokens de `small` dentro de `big`? */
function isSubset(small: string[], big: string[]): boolean {
  const bigSet = new Set(big);
  return small.every((t) => bigSet.has(t));
}

/**
 * Devuelve el nombre "más completo" de dos variantes (la que que tenga más tokens
 * significativos; a igualdad, la más larga). Sirve para quedarnos con la forma
 * canónica al fusionar.
 */
export function moreCompleteName(a: string, b: string): string {
  const ta = significantTokens(a).length;
  const tb = significantTokens(b).length;
  if (ta !== tb) return ta > tb ? a : b;
  return normalizeName(a).length >= normalizeName(b).length ? a : b;
}