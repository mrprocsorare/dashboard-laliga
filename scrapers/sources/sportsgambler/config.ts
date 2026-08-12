/**
 * Configuración de la fuente Sportsgambler.
 *
 * SG publica onces predichos a través de la página /lineups/football/spain-la-liga/
 * (listado de partidos server-rendered) y de un endpoint AJAX que devuelve el
 * once: /lineups/lineups-load2.php?id={MATCH_ID}. No expone % de titularidad,
 * pero sí formación y líneas (GK/DEF/MED/DEL). Las lesiones/sanciones están
 * server-rendered en /injuries/football/spain-la-liga/ (por equipo).
 */
export const sportsGamblerConfig = {
  sourceId: "sportsgambler",
  name: "SportsGambler",
  baseUrl: "https://www.sportsgambler.com",
  lineupsIndexPath: "/lineups/football/spain-la-liga/",
  lineupsAjaxPath: "/lineups/lineups-load2.php",
  injuriesPath: "/injuries/football/spain-la-liga/",
  /** Retardo entre peticiones (ms). */
  requestDelayMs: 500,

  /** Nombre de equipo (tal y como aparece en SG) → slug canónico. */
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
    "racing club": "racing-santander",
    "racing": "racing-santander",
    "racing santander": "racing-santander",
    "rayo vallecano": "rayo-vallecano",
    "rayo": "rayo-vallecano",
    "real madrid": "real-madrid",
    "real sociedad": "real-sociedad",
    "sociedad": "real-sociedad",
    "sevilla": "sevilla",
    "valencia": "valencia",
    "villarreal": "villarreal",
    "deportivo": "deportivo-la-coruna",
    "deportivo la coruna": "deportivo-la-coruna",
    "elche": "elche",
  } as const,
};
