/**
 * Mapa interno de aliases de jugador. Vive en un módulo separado para que
 * `services/player-names.ts`, `services/reconcile.ts`, `scripts/audit-duplicates.ts`
 * y `scripts/merge-duplicate-players.ts` compartan la MISMA fuente de verdad.
 *
 * Las claves se almacenan YA NORMALIZADAS (`normalizeName`): minúsculas, sin
 * acentos, sin puntuación. Cualquier nuevo caso de duplicación se añade aquí.
 *
 * IMPORTANTE: solo añadimos entradas INEQUÍVOCAS. No incluir nombres propios
 * cortos que puedan ser ambiguos (p. ej. "Williams", "Nico", "Iñaki") ni
 * apellidos compartidos por varios jugadores del mismo equipo.
 */
export const PLAYER_ALIASES_INTERNAL: Record<string, string> = {
  // Apellidos únicos / jugadores muy conocidos referidos por un solo token.
  lookman: "Ademola Lookman",
  aubameyang: "Pierre-Emerick Aubameyang",
  // mbappe cubre tanto "Mbappé" como "Mbappe" porque normalizeName quita tildes.
  mbappe: "Kylian Mbappé",
  vinicius: "Vinícius Júnior",
  // "Vinícius" con tilde tras normalizar produce "vinicius"; queda cubierto arriba.
  vini: "Vinícius Júnior",
  bellingham: "Jude Bellingham",
  valverde: "Federico Valverde",
  gavi: "Pablo Páez",
  pedri: "Pedro González",
  lamine: "Lamine Yamal",
  yamal: "Lamine Yamal",
  // Casos frecuentes abreviados con iniciales y/o guión.
  "a lookman": "Ademola Lookman",
  "p aubameyang": "Pierre-Emerick Aubameyang",
  "p e aubameyang": "Pierre-Emerick Aubameyang",
  "p-e aubameyang": "Pierre-Emerick Aubameyang",
  "k mbappe": "Kylian Mbappé",
  "v jr": "Vinícius Júnior",
  "vini jr": "Vinícius Júnior",
  "l yam": "Lamine Yamal",
  "l yamal": "Lamine Yamal",
  // Nombres con guión partido: muchas fuentes parten "Pierre-Emerick" en una
  // sola palabra y otras lo emiten con espacio. Cualquier forma debe resolver
  // al canónico con espacio (que es el que usan los scrapers mayoritarios).
  "pierre emerick aubameyang": "Pierre-Emerick Aubameyang",
  "pierre-emerick aubameyang": "Pierre-Emerick Aubameyang",
  "pierre emerick": "Pierre-Emerick Aubameyang",
  "pierre-emerick": "Pierre-Emerick Aubameyang",
  // Caso reportado en el dashboard (Amatucci).
  amatucci: "Lorenzo Amatucci",
};
