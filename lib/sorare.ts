const SORARE_ENDPOINT = "https://api.sorare.com/graphql";
const SCORE_CACHE_TTL_MS = 60 * 60 * 1_000;
const PRICE_CACHE_TTL_MS = 20 * 60 * 1_000;
const ERROR_CACHE_TTL_MS = 5 * 60 * 1_000;
const BATCH_SIZE = 20;

export interface SorarePlayerData {
  slug: string;
  scores: number[];
  averageScore: number | null;
  latestScore: number | null;
  priceEurCents: number | null;
  cardSlug: string | null;
  fetchedAt: string;
}

interface SorarePlayerResponse {
  slug: string;
  averageScore: number | null;
  playerGameScores: Array<{ score: number }> | null;
  lowestPriceAnyCard: {
    slug: string;
    publicMinPrices: { eurCents: number | null } | null;
    latestEnglishAuction: {
      bestBid: { amounts: { eurCents: number | null } } | null;
    } | null;
    liveSingleSaleOffer: {
      senderSide: { amounts: { eurCents: number | null } };
    } | null;
  } | null;
}

interface SorareGraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface ScoreCacheEntry {
  value: Pick<SorarePlayerData, "scores" | "averageScore" | "latestScore"> | null;
  expiresAt: number;
}

interface PriceCacheEntry {
  value: Pick<SorarePlayerData, "priceEurCents" | "cardSlug"> | null;
  expiresAt: number;
}

const scoreCache = new Map<string, ScoreCacheEntry>();
const priceCache = new Map<string, PriceCacheEntry>();

const PLAYER_DATA_QUERY = `
  query SorarePlayers($slugs: [String!]) {
    players(slugs: $slugs) {
      slug
      averageScore(type: LAST_FIVE_SO5_AVERAGE_SCORE)
      playerGameScores(last: 5) { score }
      lowestPriceAnyCard(rarity: limited) {
        slug
        publicMinPrices { eurCents }
        latestEnglishAuction { bestBid { amounts { eurCents } } }
        liveSingleSaleOffer { senderSide { amounts { eurCents } } }
      }
    }
  }
`;

interface SearchCardsResponse {
  hits: Array<{
    card: {
      anyPlayer: {
        displayName: string;
        slug?: string;
        birthDay?: string | null;
        activeClub?: { name: string; slug: string } | null;
      } | null;
    } | null;
  }>;
}

const PLAYER_SEARCH_QUERY = `
  query SearchSorarePlayers($query: String!) {
    searchCards(query: $query, page: 1, pageSize: 10) {
      hits {
        card {
          anyPlayer {
            displayName
            birthDay
            activeClub { name slug }
            ... on Player { slug }
          }
        }
      }
    }
  }
`;

function retryAfterMs(value: string | null): number {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}

async function sorareRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  attempt = 0,
): Promise<T | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.SORARE_API_KEY) headers.APIKEY = process.env.SORARE_API_KEY;

  let response: Response;
  try {
    response = await fetch(SORARE_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (response.status === 429 && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response.headers.get("retry-after"))));
    return sorareRequest<T>(query, variables, 1);
  }

  let payload: SorareGraphqlResponse<T>;
  try {
    payload = (await response.json()) as SorareGraphqlResponse<T>;
  } catch {
    return null;
  }
  if (!response.ok || payload.errors?.length || !payload.data) return null;
  return payload.data;
}

function toPriceEurCents(card: SorarePlayerResponse["lowestPriceAnyCard"]): number | null {
  if (!card) return null;
  const candidates = [
    card.publicMinPrices?.eurCents,
    card.liveSingleSaleOffer?.senderSide.amounts.eurCents,
    card.latestEnglishAuction?.bestBid?.amounts.eurCents,
  ];
  return candidates.find((value): value is number => typeof value === "number" && value > 0) ?? null;
}

function toPlayerData(player: SorarePlayerResponse): SorarePlayerData {
  const scores = (player.playerGameScores ?? [])
    .map((entry) => entry.score)
    .filter((score) => typeof score === "number" && Number.isFinite(score));
  return {
    slug: player.slug,
    scores,
    averageScore:
      typeof player.averageScore === "number" && Number.isFinite(player.averageScore)
        ? player.averageScore
        : scores.length
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : null,
    latestScore: scores[0] ?? null,
    priceEurCents: toPriceEurCents(player.lowestPriceAnyCard),
    cardSlug: player.lowestPriceAnyCard?.slug ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Obtiene datos públicos de Sorare exclusivamente desde el servidor. */
export async function getSorareData(slugs: string[]): Promise<Map<string, SorarePlayerData>> {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  const result = new Map<string, SorarePlayerData>();
  const missing: string[] = [];
  const now = Date.now();

  for (const slug of uniqueSlugs) {
    const scores = scoreCache.get(slug);
    const price = priceCache.get(slug);
    if (scores && price && scores.expiresAt > now && price.expiresAt > now && scores.value && price.value) {
      result.set(slug, {
        slug,
        ...scores.value,
        ...price.value,
        fetchedAt: new Date().toISOString(),
      });
    } else {
      missing.push(slug);
    }
  }

  for (let index = 0; index < missing.length; index += BATCH_SIZE) {
    const batch = missing.slice(index, index + BATCH_SIZE);
    const data = await sorareRequest<{ players: SorarePlayerResponse[] }>(PLAYER_DATA_QUERY, { slugs: batch });
    const returned = new Map((data?.players ?? []).map((player) => [player.slug, toPlayerData(player)]));
    for (const slug of batch) {
      const value = returned.get(slug) ?? null;
      scoreCache.set(slug, {
        value: value
          ? { scores: value.scores, averageScore: value.averageScore, latestScore: value.latestScore }
          : null,
        expiresAt: Date.now() + (value ? SCORE_CACHE_TTL_MS : ERROR_CACHE_TTL_MS),
      });
      priceCache.set(slug, {
        value: value ? { priceEurCents: value.priceEurCents, cardSlug: value.cardSlug } : null,
        expiresAt: Date.now() + (value ? PRICE_CACHE_TTL_MS : ERROR_CACHE_TTL_MS),
      });
      if (value) result.set(slug, value);
    }
  }

  return result;
}

export interface SorareSearchResult {
  slug: string;
  displayName: string;
  birthDay: string | null;
  activeClubName: string | null;
  activeClubSlug: string | null;
}

function searchResultsFromHits(hits: SearchCardsResponse["hits"]): SorareSearchResult[] {
  const results = new Map<string, SorareSearchResult>();
  for (const hit of hits) {
    const player = hit.card?.anyPlayer;
    if (player?.slug && player.displayName) {
      results.set(player.slug, {
        slug: player.slug,
        displayName: player.displayName,
        birthDay: player.birthDay ?? null,
        activeClubName: player.activeClub?.name ?? null,
        activeClubSlug: player.activeClub?.slug ?? null,
      });
    }
  }
  return [...results.values()];
}

/** Busca varios nombres en paralelo; el script limita cada grupo a 20 peticiones/minuto. */
export async function searchSorarePlayersBatch(names: string[]): Promise<SorareSearchResult[][]> {
  return Promise.all(names.map((name) => searchSorarePlayers(name)));
}

/** Busca candidatos por nombre para la herramienta de mapeo administrativo. */
export async function searchSorarePlayers(name: string): Promise<SorareSearchResult[]> {
  const data = await sorareRequest<{ searchCards: SearchCardsResponse }>(PLAYER_SEARCH_QUERY, { query: name });
  return searchResultsFromHits(data?.searchCards?.hits ?? []);
}
