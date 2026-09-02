import type { SorareCandidate } from "@/lib/sorare-matching";

const SORARE_ENDPOINT = "https://api.sorare.com/graphql";
// La API permite 20 slugs con API key, pero el límite anónimo de complejidad
// actual (500) requiere lotes más pequeños con esta selección de identidad,
// scores y las dos ediciones Limited.
const PLAYER_BATCH_SIZE = process.env.SORARE_API_KEY ? 20 : 8;
const MAX_RETRIES = 3;

export const SORARE_PLAYER_QUERY = `
  query SorarePlayers($slugs: [String!]) {
    players(slugs: $slugs) {
      ... on Player {
        id
        slug
        displayName
        firstName
        lastName
        birthDay
        country { code }
        activeClub { name slug }
        playerGameScores(last: 5) { score }
        classic: lowestPriceAnyCard(inSeason: false, rarity: limited) {
          slug
          publicMinPrices { eurCents }
          liveSingleSaleOffer { senderSide { amounts { eurCents } } receiverSide { amounts { eurCents } } }
          latestEnglishAuction { bestBid { amounts { eurCents } } }
        }
        inSeason: lowestPriceAnyCard(inSeason: true, rarity: limited) {
          slug
          publicMinPrices { eurCents }
          liveSingleSaleOffer { senderSide { amounts { eurCents } } receiverSide { amounts { eurCents } } }
          latestEnglishAuction { bestBid { amounts { eurCents } } }
        }
      }
    }
  }
`;

export const SORARE_SEARCH_QUERY = `
  query SearchSorarePlayers($query: String!) {
    searchCards(query: $query, page: 1, pageSize: 10) {
      hits {
        card {
          anyPlayer {
            displayName
            firstName
            lastName
            birthDay
            country { code }
            activeClub { name slug }
            ... on Player { id slug }
          }
        }
      }
    }
  }
`;

/**
 * Suelo de mercado fiable vía búsqueda ordenada por precio. `lowestPriceAnyCard`
 * es inestable (issue #644 de Sorare: a veces devuelve una carta que no está en
 * venta directa), así que cuando la primaria no trae venta directa usamos esta
 * consulta, que sí lista las cartas Limited ordenadas de más barata a más cara.
 */
export const SORARE_SEARCH_FLOOR_QUERY = `
  query SorareSearchFloor($query: String!, $onSaleOnly: Boolean) {
    searchCards(query: $query, onSaleOnly: $onSaleOnly, sorts: [{ field: "price", direction: ASC }], pageSize: 50) {
      hits {
        card {
          slug
          rarityTyped
          inSeasonEligible
          liveSingleSaleOffer { receiverSide { amounts { eurCents } } }
        }
      }
    }
  }
`;

interface GraphqlPayload<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface SorareCardResponse {
  slug: string;
  publicMinPrices: { eurCents: number | null } | null;
  liveSingleSaleOffer: {
    senderSide: { amounts: { eurCents: number | null } } | null;
    receiverSide: { amounts: { eurCents: number | null } } | null;
  } | null;
  latestEnglishAuction: { bestBid: { amounts: { eurCents: number | null } } | null } | null;
}

export interface SorarePlayerResponse extends SorareCandidate {
  playerGameScores: Array<{ score: number }> | null;
  classic: SorareCardResponse | null;
  inSeason: SorareCardResponse | null;
}

export interface SorareFloorPrice {
  eurCents: number | null;
  slug: string | null;
}

export interface SorareFloorPrices {
  classic: SorareFloorPrice;
  inSeason: SorareFloorPrice;
}

interface RawSorarePlayerResponse extends Omit<SorarePlayerResponse, "nationality" | "activeClubName" | "activeClubSlug"> {
  id?: string | null;
  nationality?: string | null;
  country?: { code: string } | null;
  activeClub?: { name: string; slug: string } | null;
  activeClubName?: string | null;
  activeClubSlug?: string | null;
}

export class SorareBudgetExceededError extends Error {
  constructor(public readonly budget: number) {
    super(`Presupuesto Sorare agotado (${budget} peticiones)`);
    this.name = "SorareBudgetExceededError";
  }
}

export class SorareRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Sorare ha limitado las peticiones; reintentar después de ${retryAfterMs} ms`);
    this.name = "SorareRateLimitError";
  }
}

export class SorareRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SorareRequestError";
  }
}

export interface SorareClientOptions {
  fetcher?: typeof fetch;
  budget?: number;
  requestsPerMinute?: number;
  minIntervalMs?: number;
  requestTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null): number {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}

/**
 * El suelo de mercado es el MÍNIMO de todas las fuentes de precio válidas.
 * `publicMinPrices` suele venir `null` y, cuando aparece, a veces trae un
 * valor alto obsoleto (no es el suelo real), así que usamos el mínimo en vez
 * del "primer positivo": si una fuente está inflada, el mínimo la ignora y se
 * queda con el precio de venta directa (`receiverSide`) o la mejor puja.
 */
function positivePrice(card: SorareCardResponse | null): number | null {
  if (!card) return null;
  const values = [
    card.publicMinPrices?.eurCents,
    card.liveSingleSaleOffer?.receiverSide?.amounts?.eurCents,
    card.latestEnglishAuction?.bestBid?.amounts?.eurCents,
  ].filter((value): value is number => typeof value === "number" && value > 0);
  return values.length ? Math.min(...values) : null;
}

export function toSorarePlayerResponse(value: RawSorarePlayerResponse): SorarePlayerResponse {
  return {
    ...value,
    id: value.id ?? null,
    nationality: value.nationality ?? value.country?.code ?? null,
    activeClubName: value.activeClubName ?? value.activeClub?.name ?? null,
    activeClubSlug: value.activeClubSlug ?? value.activeClub?.slug ?? null,
    playerGameScores: value.playerGameScores ?? [],
    classic: value.classic ?? null,
    inSeason: value.inSeason ?? null,
  };
}

export function priceFromSorareCard(card: SorareCardResponse | null): number | null {
  return positivePrice(card);
}

export class SorareApiClient {
  private readonly fetcher: typeof fetch;
  private readonly budget: number;
  private readonly requestsPerMinute: number;
  private readonly minIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private requestCount = 0;
  private totalRequestCount = 0;
  private gateTail: Promise<void> = Promise.resolve();
  private windowStartedAt = 0;
  private nextRequestAt = 0;
  private pausedUntil = 0;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: SorareClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.budget = options.budget ?? Number(process.env.SORARE_REQUEST_BUDGET ?? 100);
    this.requestsPerMinute = options.requestsPerMinute ?? Number(
      process.env.SORARE_REQUESTS_PER_MINUTE ?? (process.env.SORARE_API_KEY ? 30 : 12),
    );
    this.minIntervalMs = options.minIntervalMs ?? Number(
      process.env.SORARE_MIN_INTERVAL_MS ?? Math.ceil(60_000 / this.requestsPerMinute),
    );
    this.requestTimeoutMs = options.requestTimeoutMs ?? Number(
      process.env.SORARE_REQUEST_TIMEOUT_MS ?? 30_000,
    );
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
  }

  get callsUsed(): number {
    return this.totalRequestCount;
  }

  private async gate(): Promise<void> {
    const previous = this.gateTail;
    let release!: () => void;
    this.gateTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      while (true) {
        const now = this.now();
        if (now - this.windowStartedAt >= 60_000) {
          this.windowStartedAt = now;
          this.requestCount = 0;
        }
        if (this.totalRequestCount >= this.budget) throw new SorareBudgetExceededError(this.budget);
        if (this.requestCount >= this.requestsPerMinute) {
          await this.sleep(Math.max(0, this.windowStartedAt + 60_000 - now));
          continue;
        }
        const delay = Math.max(this.nextRequestAt - now, this.pausedUntil - now, 0);
        if (delay > 0) {
          await this.sleep(delay);
          continue;
        }
        this.nextRequestAt = Math.max(this.nextRequestAt, this.now()) + this.minIntervalMs;
        this.requestCount++;
        this.totalRequestCount++;
        return;
      }
    } finally {
      release();
    }
  }

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const key = JSON.stringify([query, variables]);
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = this.requestUncached<T>(query, variables).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async requestUncached<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.gate();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (process.env.SORARE_API_KEY) headers.APIKEY = process.env.SORARE_API_KEY;
      let response: Response;
      try {
        response = await this.fetcher(SORARE_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch {
        if (attempt === MAX_RETRIES - 1) throw new SorareRequestError("fallo de red contra Sorare");
        await this.sleep(2 ** attempt * 1_000);
        continue;
      }

      if (response.status === 429) {
        const delay = retryAfterMs(response.headers.get("retry-after"));
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + delay);
        if (attempt === MAX_RETRIES - 1) throw new SorareRateLimitError(delay);
        await this.sleep(delay);
        continue;
      }
      if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
        await this.sleep(2 ** attempt * 1_000);
        continue;
      }

      let payload: GraphqlPayload<T>;
      try {
        payload = (await response.json()) as GraphqlPayload<T>;
      } catch {
        throw new SorareRequestError("respuesta JSON invalida de Sorare");
      }
      if (!response.ok || payload.errors?.length || !payload.data) {
        throw new SorareRequestError(payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ?? `HTTP ${response.status}`);
      }
      return payload.data;
    }
    throw new SorareRequestError("Sorare no respondió tras los reintentos");
  }

  async getPlayers(slugs: string[]): Promise<SorarePlayerResponse[]> {
    const unique = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
    const result: SorarePlayerResponse[] = [];
    for (let index = 0; index < unique.length; index += PLAYER_BATCH_SIZE) {
      const data = await this.request<{ players: SorarePlayerResponse[] }>(SORARE_PLAYER_QUERY, {
        slugs: unique.slice(index, index + PLAYER_BATCH_SIZE),
      });
      result.push(...(data.players ?? []).map(toSorarePlayerResponse));
    }
    return result;
  }

  async searchPlayers(names: string[], concurrency = 2): Promise<Map<string, SorareCandidate[]>> {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const result = new Map<string, SorareCandidate[]>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const name = unique[cursor++];
        const data = await this.request<{
          searchCards: { hits: Array<{ card: { anyPlayer: (SorareCandidate & { country?: { code: string } | null; activeClub?: { name: string; slug: string } | null }) | null } | null }> };
        }>(SORARE_SEARCH_QUERY, { query: name });
        const candidates = new Map<string, SorareCandidate>();
        for (const hit of data.searchCards?.hits ?? []) {
          const player = hit.card?.anyPlayer;
          if (player?.slug) {
            candidates.set(player.slug, {
              ...player,
              id: player.id ?? null,
              nationality: player.nationality ?? player.country?.code ?? null,
              activeClubName: player.activeClubName ?? player.activeClub?.name ?? null,
              activeClubSlug: player.activeClubSlug ?? player.activeClub?.slug ?? null,
            });
          }
        }
        result.set(name, [...candidates.values()]);
      }
    };
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, () => worker());
    await Promise.all(workers);
    return result;
  }

  /**
   * Suelo de mercado (Limited) de un jugador usando la búsqueda ordenada por
   * precio. Devuelve el mínimo `liveSingleSaleOffer.receiverSide` (venta directa)
   * entre las cartas Limited, separado en clásico (no in-season) e in-season.
   * Es el respaldo fiable frente a la inestabilidad de `lowestPriceAnyCard`.
   */
  async searchPlayerFloorPrices(query: string, onSaleOnly = true): Promise<SorareFloorPrices> {
    const data = await this.request<{
      searchCards: {
        hits: Array<{
          card: {
            slug: string;
            rarityTyped: string;
            inSeasonEligible: boolean | null;
            liveSingleSaleOffer: { receiverSide: { amounts: { eurCents: number | null } } } | null;
          } | null;
        }>;
      };
    }>(SORARE_SEARCH_FLOOR_QUERY, { query, onSaleOnly });
    const hits = data.searchCards?.hits ?? [];
    const cards = hits.map((hit) => hit.card).filter((card): card is NonNullable<typeof card> => Boolean(card));
    const directOf = (card: typeof cards[number]): number | null => {
      const value = card.liveSingleSaleOffer?.receiverSide?.amounts?.eurCents;
      return typeof value === "number" && value > 0 ? value : null;
    };
    const limited = cards.filter((card) => card.rarityTyped === "limited");
    const floorOf = (group: typeof limited): SorareFloorPrice => {
      const values = group.map(directOf).filter((value): value is number => value !== null);
      if (!values.length) return { eurCents: null, slug: null };
      const min = Math.min(...values);
      return { eurCents: min, slug: group.find((card) => directOf(card) === min)!.slug };
    };
    return {
      classic: floorOf(limited.filter((card) => !card.inSeasonEligible)),
      inSeason: floorOf(limited.filter((card) => card.inSeasonEligible)),
    };
  }
}

/** Compatibilidad para la herramienta antigua de revisión CSV. */
export async function searchSorarePlayersBatch(names: string[]): Promise<SorareCandidate[][]> {
  const client = new SorareApiClient();
  const found = await client.searchPlayers(names, 1);
  return names.map((name) => found.get(name.trim()) ?? []);
}

function directSalePrice(card: SorareCardResponse | null): number | null {
  const value = card?.liveSingleSaleOffer?.receiverSide?.amounts?.eurCents;
  return typeof value === "number" && value > 0 ? value : null;
}

function auctionPrice(card: SorareCardResponse | null): number | null {
  const value = card?.latestEnglishAuction?.bestBid?.amounts?.eurCents;
  return typeof value === "number" && value > 0 ? value : null;
}

function publicPrice(card: SorareCardResponse | null): number | null {
  const value = card?.publicMinPrices?.eurCents;
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * Precio de suelo (Limited) de un jugador combinando dos fuentes:
 * 1. `lowestPriceAnyCard` (barato, una sola petición): si devuelve una carta
 *    con venta directa (`liveSingleSaleOffer.receiverSide`), ese es el suelo.
 * 2. Si la primaria no trae venta directa — el caso del bug #644 de Sorare,
 *    donde devuelve una carta sin listar en venta — se hace fallback a
 *    `searchPlayerFloorPrices` (búsqueda ordenada por precio), que sí encuentra
 *    el suelo real. Solo en último extremo se usa la puja de subasta.
 */
export async function computePlayerPrices(
  player: SorarePlayerResponse,
  client: SorareApiClient,
  query: string,
): Promise<SorareFloorPrices> {
  const classicDirect = directSalePrice(player.classic) ?? publicPrice(player.classic);
  const inSeasonDirect = directSalePrice(player.inSeason) ?? publicPrice(player.inSeason);
  let classic: SorareFloorPrice =
    classicDirect !== null
      ? { eurCents: classicDirect, slug: player.classic?.slug ?? null }
      : { eurCents: null, slug: null };
  let inSeason: SorareFloorPrice =
    inSeasonDirect !== null
      ? { eurCents: inSeasonDirect, slug: player.inSeason?.slug ?? null }
      : { eurCents: null, slug: null };
  if (classic.eurCents === null || inSeason.eurCents === null) {
    try {
      const floor = await client.searchPlayerFloorPrices(query);
      if (classic.eurCents === null) classic = floor.classic;
      if (inSeason.eurCents === null) inSeason = floor.inSeason;
    } catch {
      /* se mantiene el valor actual y se prueba la subasta abajo */
    }
  }
  if (classic.eurCents === null) {
    const p = auctionPrice(player.classic) ?? publicPrice(player.classic);
    classic = { eurCents: p, slug: player.classic?.slug ?? null };
  }
  if (inSeason.eurCents === null) {
    const p = auctionPrice(player.inSeason) ?? publicPrice(player.inSeason);
    inSeason = { eurCents: p, slug: player.inSeason?.slug ?? null };
  }
  return { classic, inSeason };
}
