/**
 * Tabla GENERAL de diminutivos de nombre de pila, aplicable a cualquier
 * apellido. Esta es la pieza que faltaba en el matching anterior: en lugar de
 * hardcodear parejas de nombre completo ("Álex Balde" → "Alejandro Balde"),
 * definimos reglas reutilizables ("Álex" → "Alejandro") que el matcher de dos
 * fases aplica al PRIMER token del nombre antes de comparar con el roster.
 *
 * Esto resuelve el bug de "Álex Grimaldo" / "Alejandro Grimaldo" y, por
 * extensión, cualquier otro par de nombre formal + diminutivo común del
 * fútbol español.
 *
 * Las claves se almacenan YA NORMALIZADAS (minúsculas, sin acentos) para que
 * `normalize` no falle con tildes. El valor es la forma canónica del
 * nombre de pila (también normalizado).
 *
 * Origen de los pares:
 *  - Los ya identificados en `FIRST_NAME_ALIASES` (services/player-names.ts)
 *    y mantenidos históricamente.
 *  - Los que se observan en el roster canónico real (consulta SQL de primeros
 *    nombres del sync-roster) con varios jugadores del mismo nombre formal
 *    con diminutivos distintos (p. ej. "Javi" 5 veces ↔ "Javier" 3 veces).
 *  - Diminutivos tradicionales del español que pueden aparecer en la BD
 *    cuando un scraper usa el apodo.
 *
 * Regla de oro: solo añadimos pares INEQUÍVOCOS. Si un diminutivo es ambiguo
 * (p. ej. "Nico" podría ser diminutivo de "Nicolás", "Nicola" o
 * "Dominico"), lo dejamos fuera y aceptamos el false negative temporal;
 * añadirlo requiere evidencia clara de que el canónico está en el roster.
 */

const _table: Record<string, string> = {
  // === Ya existentes en FIRST_NAME_ALIASES (mantenidos por compatibilidad) ===
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
  rubén: "ruben",
  rubo: "ruben",
  youssef: "youssef",
  yusi: "youssef",
  jose: "jose",
  josé: "jose",
  pepe: "jose",
  francisco: "francisco",
  paco: "francisco",
  francis: "francisco",
  antonio: "antonio",
  toni: "antonio",
  rafael: "rafael",
  rafa: "rafael",
  manuel: "manuel",
  manu: "manuel",
  jesus: "jesus",
  jesús: "jesus",
  chus: "jesus",

  // === Nuevos: pares observados en el roster canónico (Wikipedia 2026-27) ===
  daniel: "daniel",
  dani: "daniel",
  adrian: "adrian",
  adrián: "adrian",
  adrià: "adrian",
  enrique: "enrique",
  kike: "enrique",
  quique: "enrique",
  cristian: "cristian",
  cuti: "cristian",
  nicolas: "nicolas",
  nicolás: "nicolas",
  nico: "nicolas",
  julian: "julian",
  julián: "julian",
  julen: "julian",
  santiago: "santiago",
  yago: "santiago",
  iago: "santiago",
  pedro: "pedro",
  peio: "pedro",
  luis: "luis",
  luismi: "luis",
  luiz: "luis",
  john: "john",
  johnny: "john",
  roberto: "roberto",
  robert: "roberto",
  rober: "roberto",
  joaquin: "joaquin",
  joaquín: "joaquin",
  kiko: "francisco",
  benito: "benito",
  beñat: "benito",
};

/**
 * Devuelve la forma canónica (normalizada) de un nombre de pila, o null si
 * no está en la tabla. Es seguro llamar siempre.
 */
export function firstNameCanon(raw: string): string | null {
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return _table[normalized] ?? null;
}

/**
 * Compara dos nombres de pila y devuelve `true` si son la misma persona
 * (iguales, o uno es diminutivo del otro según la tabla).
 *
 * Compara también por **inicial** ("P." = "Pedro"): si uno es una sola letra
 * y el otro empieza por esa misma letra (case-insensitive, sin acentos),
 * se consideran la misma persona.
 */
export function sameFirstName(a: string, b: string): boolean {
  if (!a || !b) return false;
  const normA = a
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  const normB = b
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // Tabla de diminutivos.
  const ca = _table[normA] ?? normA;
  const cb = _table[normB] ?? normB;
  if (ca === cb) return true;

  // Inicial: "p." = "pedro" si uno es 1 letra y el otro empieza por esa letra.
  if (normA.length === 1 && normB.startsWith(normA)) return true;
  if (normB.length === 1 && normA.startsWith(normB)) return true;

  return false;
}

export const FIRST_NAME_TABLE_SIZE = Object.keys(_table).length;
