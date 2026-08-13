/**
 * Configuración de la fuente Biwenger (biwenger.as.com).
 *
 * Biwenger publica onces probables por jornada en
 *   /blog/partidos/{temporada}/jornada-{n}/{local}-{visitante}-{id}/
 * La página de cada partido contiene dos `div.field.football` (uno por equipo)
 * con filas `div.wN` (N jugadores por fila) ordenadas de ataque (arriba) a
 * portero (abajo). No expone % de titularidad: el once publicado se asume
 * cierto (100%). También incluye una sección "No disponibles" (lesionados,
 * sancionados, dudas) por equipo.
 */

export const biwengerConfig = {
  sourceId: "biwenger",
  name: "Biwenger",
  baseUrl: "https://biwenger.as.com",
  /** Índice de la jornada vigente. */
  indexPath: "/blog/alineaciones-posibles-jornada/",
  /** Retardo entre peticiones (ms). */
  requestDelayMs: 500,
  /** Temporada actual (segmento de la URL de partido). */
  season: "2026-2027",

  /** Nombre de equipo tal y como aparece en el heading → slug canónico. */
  teamNameToSlug: {
    alavés: "alaves",
    alaves: "alaves",
    athletic: "athletic-bilbao",
    atlético: "atletico-madrid",
    atletico: "atletico-madrid",
    barcelona: "barcelona",
    betis: "real-betis",
    celta: "celta-vigo",
    deportivo: "deportivo-la-coruna",
    elche: "elche",
    espanyol: "espanyol",
    getafe: "getafe",
    levante: "levante",
    málaga: "malaga",
    malaga: "malaga",
    osasuna: "osasuna",
    racing: "racing-santander",
    "rayo vallecano": "rayo-vallecano",
    rayo: "rayo-vallecano",
    "real madrid": "real-madrid",
    "real sociedad": "real-sociedad",
    sevilla: "sevilla",
    valencia: "valencia",
    villarreal: "villarreal",
  } as const,

  /** Slug de equipo usado en la URL de partido → slug canónico. */
  biwengerSlugToCanonical: {
    alaves: "alaves",
    athletic: "athletic-bilbao",
    atletico: "atletico-madrid",
    barcelona: "barcelona",
    betis: "real-betis",
    celta: "celta-vigo",
    deportivo: "deportivo-la-coruna",
    elche: "elche",
    espanyol: "espanyol",
    getafe: "getafe",
    levante: "levante",
    malaga: "malaga",
    osasuna: "osasuna",
    racing: "racing-santander",
    "rayo-vallecano": "rayo-vallecano",
    "real-madrid": "real-madrid",
    "real-sociedad": "real-sociedad",
    sevilla: "sevilla",
    valencia: "valencia",
    villarreal: "villarreal",
  } as const,
};