/**
 * Configuración de la fuente Comuniate.
 * El mapeo de IDs de equipo de Comuniate a nuestros slugs canónicos se vuelca
 * aquí para que el scraper no dependa de "adivinar" el nombre en la página.
 */
export const comuniateConfig = {
  sourceId: "comuniate",
  name: "Comuniate",
  baseUrl: "https://www.comuniate.com",
  indexPath: "/alineaciones/comunio",
  ajaxLineupPath: "/ajax/pintar_alineacion.php",
  /** Retardo entre peticiones (ms) para ser amables con la fuente. */
  requestDelayMs: 350,

  /** id de equipo de Comuniate → slug canónico de nuestra BBDD. */
  teamIdToSlug: {
    89: "alaves",
    1: "athletic-bilbao",
    2: "atletico-madrid",
    3: "barcelona",
    4: "real-betis",
    5: "celta-vigo",
    6: "deportivo-la-coruna",
    75: "elche",
    7: "espanyol",
    8: "getafe",
    10: "levante",
    65: "malaga",
    12: "osasuna",
    14: "racing-santander",
    70: "rayo-vallecano",
    15: "real-madrid",
    13: "real-sociedad",
    17: "sevilla",
    18: "valencia",
    19: "villarreal",
  } as const,

  /** Secciones de la maqueta del once → posición canónica. */
  positionSections: {
    portero: "POR",
    defensas: "DEF",
    medios: "MED",
    delanteros: "DEL",
  } as const,
};

export type ComuniateTeamId = number;
export const COMMONIATE_TEAM_IDS = Object.keys(
  comuniateConfig.teamIdToSlug,
).map(Number);