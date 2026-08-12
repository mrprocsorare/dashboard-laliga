/**
 * Configuración de la fuente Analítica Fantasy.
 *
 * AF publica onces probables por jornada. La página de jornada expone un
 * bloque JSON-LD (`application/ld+json`) con el ItemList de partidos de esa
 * jornada (solo los que ya tienen once publicado). Las páginas de partido
 * (/partido/{id}-{local}-{visitante}) se sirven por SSR con el once completo
 * de ambos equipos.
 *
 * Nota: los nombres de equipo del JSON-LD no son nuestros slugs; mantenemos
 * aquí el mapeo.
 */
export const analiticaConfig = {
  sourceId: "analiticafantasy",
  name: "Analítica Fantasy",
  baseUrl: "https://www.analiticafantasy.com",
  /** Página de la jornada vigente (los partidos de la jornada actual). */
  indexTemplate: "/alineaciones-probables/la-liga/temporada-2026/jornada-1",
  /** Retardo entre peticiones (ms). */
  requestDelayMs: 500,

  /** Nombre de equipo (tal y como aparece en AF) → slug canónico. */
  teamNameToSlug: {
    "alaves": "alaves",
    "athletic club": "athletic-bilbao",
    "athletic": "athletic-bilbao",
    "atletico madrid": "atletico-madrid",
    "atletico": "atletico-madrid",
    "barcelona": "barcelona",
    "real betis": "real-betis",
    "betis": "real-betis",
    "celta vigo": "celta-vigo",
    "celta": "celta-vigo",
    "getafe": "getafe",
    "espanyol": "espanyol",
    "levante": "levante",
    "malaga": "malaga",
    "osasuna": "osasuna",
    "racing santander": "racing-santander",
    "racing": "racing-santander",
    "rayo vallecano": "rayo-vallecano",
    "rayo": "rayo-vallecano",
    "real madrid": "real-madrid",
    "real sociedad": "real-sociedad",
    "sociedad": "real-sociedad",
    "sevilla": "sevilla",
    "valencia": "valencia",
    "villarreal": "villarreal",
    "deportivo la coruna": "deportivo-la-coruna",
    "deportivo": "deportivo-la-coruna",
    "elche": "elche",
  } as const,
};
