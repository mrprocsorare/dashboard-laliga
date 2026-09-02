import { futbolfantasyConfig } from "@/scrapers/sources/futbolfantasy/config";
import { jornadaPerfectaConfig } from "@/scrapers/sources/jornadaperfecta/config";

const FF_CANONICAL_TO_FF_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(futbolfantasyConfig.teamSlugToCanonical).map(([ff, canonical]) => [canonical, ff]),
);

const JP_CANONICAL_TO_JP_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(jornadaPerfectaConfig.teamSlugToCanonical).map(([jp, canonical]) => [canonical, jp]),
);

const COMUNIATE_TEAM_URLS: Record<string, string> = {
  "alaves": "89/alaves-alineacion",
  "athletic-bilbao": "1/athletic-club-alineacion",
  "atletico-madrid": "2/atletico-alineacion",
  "barcelona": "3/barcelona-alineacion",
  "real-betis": "4/betis-alineacion",
  "celta-vigo": "5/celta-alineacion",
  "deportivo-la-coruna": "6/deportivo-alineacion",
  "elche": "75/elche-alineacion",
  "espanyol": "7/espanyol-alineacion",
  "getafe": "8/getafe-alineacion",
  "levante": "10/levante-alineacion",
  "malaga": "65/malaga-alineacion",
  "osasuna": "12/osasuna-alineacion",
  "racing-santander": "14/racing-alineacion",
  "rayo-vallecano": "70/rayo-vallecano-alineacion",
  "real-madrid": "15/real-madrid-alineacion",
  "real-sociedad": "13/real-sociedad-alineacion",
  "sevilla": "17/sevilla-alineacion",
  "valencia": "18/valencia-alineacion",
  "villarreal": "19/villarreal-alineacion",
};

const ANALITICA_TEAM_SLUGS: Record<string, string> = {
  "alaves": "alaves-542",
  "athletic-bilbao": "athletic-club-531",
  "atletico-madrid": "atletico-madrid-530",
  "barcelona": "barcelona-529",
  "real-betis": "real-betis-543",
  "celta-vigo": "celta-vigo-538",
  "deportivo-la-coruna": "deportivo-la-coruna-544",
  "elche": "elche-797",
  "espanyol": "espanyol-540",
  "getafe": "getafe-546",
  "levante": "levante-539",
  "malaga": "malaga-535",
  "osasuna": "osasuna-727",
  "racing-santander": "racing-santander-4665",
  "rayo-vallecano": "rayo-vallecano-728",
  "real-madrid": "real-madrid-541",
  "real-sociedad": "real-sociedad-548",
  "sevilla": "sevilla-536",
  "valencia": "valencia-532",
  "villarreal": "villarreal-533",
};

export function getSourceTeamUrl(sourceSlug: string, teamSlug: string): string | null {
  switch (sourceSlug) {
    case "futbolfantasy": {
      const ff = FF_CANONICAL_TO_FF_SLUG[teamSlug];
      return ff ? `https://www.futbolfantasy.com/laliga/equipos/${ff}` : null;
    }
    case "comuniate": {
      const path = COMUNIATE_TEAM_URLS[teamSlug];
      return path ? `https://www.comuniate.com/equipos/${path}` : null;
    }
    case "analiticafantasy": {
      const a = ANALITICA_TEAM_SLUGS[teamSlug];
      return a ? `https://www.analiticafantasy.com/equipo/${a}` : null;
    }
    case "jornadaperfecta": {
      const jp = JP_CANONICAL_TO_JP_SLUG[teamSlug];
      return jp ? `https://www.jornadaperfecta.com/equipo/${jp}` : null;
    }
    default:
      return null;
  }
}
