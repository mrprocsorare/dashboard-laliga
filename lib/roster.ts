/**
 * Roster canónico de los equipos de LaLiga desde Wikipedia (vía API oficial
 * de MediaWiki, sin scraping HTML).
 *
 * Por qué Wikipedia y no API-Football / Transfermarkt:
 *  - API-Football plan gratuito solo cubre temporadas 2022-2024; nuestro
 *    proyecto trabaja con la temporada actual.
 *  - Wikipedia mantiene la sección "Plantilla 20XX-YY" / "Plantel 20XX-YY"
 *    actualizada al inicio de cada temporada por editores especializados.
 *  - La API oficial de MediaWiki es estable, documentada y rate-limit friendly.
 *
 * Por cada equipo obtenemos un objeto `CanonicalRoster`:
 *   - `players`: lista CERRADA y estable de {name, pos} canónicos.
 *   - `fetchedAt`: fecha del fetch (para cache mensual).
 *
 * El matching cerrado contra este roster (en `services/persist.ts`) reemplaza
 * el matching abierto contra cualquier nombre scrapeado: cualquier nombre que
 * no se identifique con suficiente confianza contra el roster cerrado va a
 * parar a `unmatched_forecasts` para revisión manual.
 */
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";

const UA = "dashboard-laliga-roster-fetcher/1.0 (https://github.com/mrprocsorare/dashboard-laliga)";

export interface CanonicalPlayer {
  /** Nombre completo canónico tal y como aparece en Wikipedia. */
  name: string;
  /** Posición normalizada: POR / DEF / MED / DEL. */
  pos: "POR" | "DEF" | "MED" | "DEL";
}

export interface CanonicalRoster {
  /** Slug del equipo en nuestro catálogo. */
  teamSlug: string;
  /** Título de la página de Wikipedia leída. */
  wikiPage: string;
  /** Título exacto de la sección dentro de la página. */
  wikiSection: string;
  players: CanonicalPlayer[];
  fetchedAt: Date;
}

export interface TeamWikiTarget {
  /** Slug canónico en nuestro catálogo. */
  slug: string;
  /** Título exacto de la página de Wikipedia. */
  wikiPage: string;
  /** Regex que matchea la sección de la plantilla (toleramos "Plantilla", "Plantel", temporada…). */
  sectionPattern: RegExp;
}

/**
 * Mapeo de los 20 equipos del catálogo al título y sección de Wikipedia.
 * La temporada objetivo es la 2026-2027 (la vigente al construir este módulo).
 * Si Wikipedia renombra la sección (p. ej. "Plantilla 2027-28") basta con
 * ajustar el regex; el resto del pipeline no cambia.
 */
/**
 * Patrón tolerante: matchea cualquier sección cuyo título contenga
 * "plantilla", "plantel" o "plantilla y cuerpo técnico", en cualquier temporada
 * 2025-2027 (la actual o las inmediatamente anterior/posterior, por si
 * Wikipedia aún no ha actualizado).
 */
const DEFAULT_SECTION = /plantill?a|plantel.*20(2[5-7])/i;

export const WIKI_TARGETS: TeamWikiTarget[] = [
  { slug: "alaves", wikiPage: "Deportivo Alavés", sectionPattern: DEFAULT_SECTION },
  { slug: "athletic-bilbao", wikiPage: "Athletic Club", sectionPattern: DEFAULT_SECTION },
  { slug: "atletico-madrid", wikiPage: "Atlético de Madrid", sectionPattern: DEFAULT_SECTION },
  { slug: "barcelona", wikiPage: "Fútbol Club Barcelona", sectionPattern: DEFAULT_SECTION },
  { slug: "celta-vigo", wikiPage: "Real Club Celta de Vigo", sectionPattern: DEFAULT_SECTION },
  { slug: "deportivo-la-coruna", wikiPage: "Real Club Deportivo de La Coruña", sectionPattern: DEFAULT_SECTION },
  { slug: "elche", wikiPage: "Elche Club de Fútbol", sectionPattern: DEFAULT_SECTION },
  { slug: "espanyol", wikiPage: "Reial Club Deportiu Espanyol de Barcelona", sectionPattern: DEFAULT_SECTION },
  { slug: "getafe", wikiPage: "Getafe Club de Fútbol", sectionPattern: DEFAULT_SECTION },
  { slug: "levante", wikiPage: "Levante Unión Deportiva", sectionPattern: DEFAULT_SECTION },
  { slug: "malaga", wikiPage: "Málaga Club de Fútbol", sectionPattern: DEFAULT_SECTION },
  { slug: "osasuna", wikiPage: "Club Atlético Osasuna", sectionPattern: DEFAULT_SECTION },
  { slug: "racing-santander", wikiPage: "Real Racing Club de Santander", sectionPattern: DEFAULT_SECTION },
  { slug: "rayo-vallecano", wikiPage: "Rayo Vallecano de Madrid", sectionPattern: DEFAULT_SECTION },
  { slug: "real-betis", wikiPage: "Real Betis Balompié", sectionPattern: DEFAULT_SECTION },
  { slug: "real-madrid", wikiPage: "Real Madrid Club de Fútbol", sectionPattern: DEFAULT_SECTION },
  { slug: "real-sociedad", wikiPage: "Real Sociedad de Fútbol", sectionPattern: DEFAULT_SECTION },
  { slug: "sevilla", wikiPage: "Sevilla Fútbol Club", sectionPattern: DEFAULT_SECTION },
  { slug: "valencia", wikiPage: "Valencia Club de Fútbol", sectionPattern: DEFAULT_SECTION },
  { slug: "villarreal", wikiPage: "Villarreal Club de Fútbol", sectionPattern: DEFAULT_SECTION },
];

interface WikiSection {
  index: string;
  line: string;
}

function httpJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error(`JSON parse error: ${(body || "").slice(0, 200)}`));
          }
        });
      })
      .on("error", reject);
  });
}

/**
 * Parsea el wikitext de una sección de plantilla de Wikipedia.
 * Estrategia: cada jugador está dentro de
 *   {{Jugador de fútbol con esquema|num=...|pos=POR|nombre=[[Nombre Apellido]]|...}}
 * con posibles refs anidadas {{...}}. Regex tolerante a 1 nivel de anidamiento.
 */
export function parsePlantillaWikitext(wt: string): CanonicalPlayer[] {
  const players: CanonicalPlayer[] = [];
  // Captura cada plantilla {{Jugador de fútbol con esquema|...}} tolerando
  // anidamiento de 1 nivel (refs {{...}}).
  const templateRe =
    /\{\{Jugador de fútbol con esquema\|((?:[^{}]|\{\{[^{}]*\}\})*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = templateRe.exec(wt)) !== null) {
    const fields = m[1];
    const posM = /\|pos=([A-Z]+)/.exec(fields);
    const nombreMatch = fields.match(/\|nombre=([\s\S]*?)(?=\|[a-z]+=|\}\}$)/);
    if (!posM || !nombreMatch) continue;
    let nombre = nombreMatch[1];
    // Quita refs {{...}} anidadas.
    nombre = nombre.replace(/\{\{[^{}]*\}\}/g, "");
    // Convierte [[X|Y]] y [[X]] → X. Acepta prefijos interwiki (:en:, :fr:).
    nombre = nombre.replace(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g, "$1");
    // Quita prefijos interwiki que sobreviven (p. ej. ":en:Hugo López").
    nombre = nombre.replace(/(^|\s):?[a-z]{2,}:/g, "$1");
    // Quita negritas ''' y HTML residual.
    nombre = nombre.replace(/'''|<[^>]+>/g, "");
    // Decodifica entidades HTML comunes.
    nombre = nombre
      .replace(/&thinsp;|&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#?\w+;/g, "");
    // Quita cualquier texto entre < y > por si queda algo.
    nombre = nombre.replace(/<[^>]+>/g, "");
    // Quita anotaciones entre paréntesis que Wikipedia añade para desambiguar
    // (ej. "Ángel Pérez (jugador nacido en 2002)" → "Ángel Pérez").
    nombre = nombre.replace(/\s*\([^)]*\)\s*/g, " ");
    // Quita sufijos residuales tipo " Archivo:Captain sports.svg" o
    // restos de plantillas que no se cerraron.
    nombre = nombre.replace(/\s*(Archivo|File|Imagen|Image):.*$/i, "");
    // Quita posibles restos de pipes sueltos al final.
    nombre = nombre.replace(/[\|<]+$/g, "");
    nombre = nombre.replace(/\s+/g, " ").trim();
    if (!nombre || /^\W*$/.test(nombre)) continue;
    // Filtra nombres obviously incorrectos (1 letra, números solos).
    if (nombre.length < 3) continue;
    // Filtra "nombres" que no son personas: una sola palabra sin segunda
    // palabra típica (los nombres de jugador tienen al menos nombre + apellido,
    // p. ej. "Costa de Marfil" pasa porque tiene 3 palabras pero es un país —
    // lo detectamos porque no empieza con mayúscula tras el primer token o
    // porque parece geográfico). Estrategia conservadora: exigimos que NO
    // parezca un país y que tenga ≥2 palabras donde la primera es un nombre
    // propio (no una palabra genérica tipo "Costa", "Imagen", "File"...).
    const words = nombre.split(/\s+/);
    if (words.length < 2) continue;
    // Palabras que delatan que NO es un nombre propio de persona.
    const blacklist = [
      "costa", "imagen", "file", "archivo", "image", "ref", "nota",
      "selección", "seleccion", "team", "equipo",
    ];
    if (blacklist.some((b) => words.some((w) => w.toLowerCase() === b))) continue;
    const pos = normalizePos(posM[1]);
    if (!pos) continue;
    players.push({ name: nombre, pos });
  }
  return players;
}

function normalizePos(raw: string): CanonicalPlayer["pos"] | null {
  switch (raw) {
    case "POR":
    case "DEF":
    case "MED":
    case "DEL":
      return raw;
    case "GK":
    case "Goalkeeper":
      return "POR";
    case "DF":
    case "Defender":
      return "DEF";
    case "MF":
    case "Midfielder":
      return "MED";
    case "FW":
    case "Attacker":
    case "Forward":
      return "DEL";
    default:
      return null;
  }
}

/** Fetch de un equipo concreto. Hace hasta 3 requests a Wikipedia (resolve redirects + sections + wikitext). */
export async function fetchRoster(target: TeamWikiTarget): Promise<CanonicalRoster> {
  await sleep(200);
  // 1) Resolver redirects.
  const redirUrl = `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    target.wikiPage,
  )}&redirects=1&format=json`;
  const redirJson = await httpJson<{ query?: { redirects?: { to: string }[] } }>(redirUrl);
  const finalTitle = redirJson.query?.redirects?.[0]?.to ?? target.wikiPage;

  await sleep(200);
  // 2) Índice de secciones.
  const sectionsUrl = `https://es.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    finalTitle,
  )}&format=json&prop=sections`;
  const sectionsJson = await httpJson<{ parse?: { sections?: WikiSection[] } }>(sectionsUrl);
  const sections = sectionsJson.parse?.sections ?? [];
  const section = sections.find((s) => target.sectionPattern.test(s.line));
  if (!section) {
    throw new Error(
      `No se encontró la sección de plantilla en ${finalTitle} con patrón ${target.sectionPattern}`,
    );
  }
  await sleep(200);
  // 3) Wikitext de la sección.
  const wikitextUrl = `https://es.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    finalTitle,
  )}&format=json&prop=wikitext&section=${section.index}`;
  const wikitextJson = await httpJson<{ parse?: { wikitext?: { "*"?: string } } }>(
    wikitextUrl,
  );
  const wt = wikitextJson.parse?.wikitext?.["*"] ?? "";
  const players = parsePlantillaWikitext(wt);
  return {
    teamSlug: target.slug,
    wikiPage: finalTitle,
    wikiSection: section.line,
    players,
    fetchedAt: new Date(),
  };
}

/** Fetch de todos los equipos del catálogo. Continúa ante errores. */
export async function fetchAllRosters(): Promise<{
  ok: CanonicalRoster[];
  failed: { slug: string; wikiPage: string; error: string }[];
}> {
  const ok: CanonicalRoster[] = [];
  const failed: { slug: string; wikiPage: string; error: string }[] = [];
  for (const target of WIKI_TARGETS) {
    try {
      const r = await fetchRoster(target);
      ok.push(r);
    } catch (err) {
      failed.push({
        slug: target.slug,
        wikiPage: target.wikiPage,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok, failed };
}
