/**
 * Configuración de la fuente Jornada Perfecta.
 *
 * JP sirve el once probable de cada partido de forma server-side en
 * /partido/{id}/{local}-{visitante}. La homepage /onces-posibles/ lista los
 * partidos de la jornada actual (div.match-scroll). Cada jugador del once se
 * marca con la fila del campo (linea-N → posición) y un % de titularidad
 * (div.percent-budget). Las bajas van en la sección #unavailable (fifa-card).
 *
 * Los slugs de equipo de las URLs de JP no son nuestros slugs canónicos;
 * mantenemos aquí el mapeo.
 */
export const jornadaPerfectaConfig = {
  sourceId: "jornadaperfecta",
  name: "Jornada Perfecta",
  baseUrl: "https://www.jornadaperfecta.com",
  /** Página que lista los partidos de la jornada vigente. */
  indexTemplate: "/onces-posibles/",
  /** Retardo entre peticiones (ms). */
  requestDelayMs: 500,

  /** Slug de JP → slug canónico. */
  teamSlugToCanonical: {
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

export type JornaPerfectaTeamSlug = keyof typeof jornadaPerfectaConfig.teamSlugToCanonical;

/** Slugs de JP ordenados por longitud desc para resolver URLs ambiguas. */
export const JP_TEAM_SLUGS_BY_LENGTH = Object.keys(
  jornadaPerfectaConfig.teamSlugToCanonical,
).sort((a, b) => b.length - a.length);
