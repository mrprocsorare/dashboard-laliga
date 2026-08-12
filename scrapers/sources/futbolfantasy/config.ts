/**
 * Configuración de la fuente FutbolFantasy.
 *
 * FF publica cada jornada un calendario en /laliga/posibles-alineaciones y una
 * página por partido (/partidos/{id}-{local}-{visitante}) con el once probable
 * de ambos equipos, su probabilidad, suplentes/alternativas y los módulos de
 * lesionados y sancionados.
 *
 * Nota: los slugs de equipo en las URLs de FF NO siempre coinciden con los
 * nuestros (usan "atletico", "racing", "rayo"... y algunos con guion como
 * "real-madrid"/"real-sociedad"). Por eso mantenemos aquí el mapeo completo.
 */
export const futbolfantasyConfig = {
  sourceId: "futbolfantasy",
  name: "FutbolFantasy",
  baseUrl: "https://www.futbolfantasy.com",
  indexPath: "/laliga/posibles-alineaciones",
  /** Retardo entre peticiones (ms). */
  requestDelayMs: 500,

  /** Slug de FF → slug canónico de nuestra BBDD. */
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
    rayo: "rayo-vallecano",
    "real-madrid": "real-madrid",
    "real-sociedad": "real-sociedad",
    sevilla: "sevilla",
    valencia: "valencia",
    villarreal: "villarreal",
  } as const,
};

export type FutbolFantasyTeamSlug = keyof typeof futbolfantasyConfig.teamSlugToCanonical;

/** Slugs de FF ordenados por longitud desc para resolver URLs ambiguas. */
export const FF_TEAM_SLUGS_BY_LENGTH = Object.keys(
  futbolfantasyConfig.teamSlugToCanonical,
).sort((a, b) => b.length - a.length);
