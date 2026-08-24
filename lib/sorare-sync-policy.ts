export const SORARE_IDENTITY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SORARE_SCORES_TTL_MS = 24 * 60 * 60 * 1_000;
export const SORARE_PRICES_TTL_MS = 24 * 60 * 60 * 1_000;

export interface SorareCacheFreshness {
  scoresExpiresAt: Date | null;
  classicExpiresAt: Date | null;
  inSeasonExpiresAt: Date | null;
}

export interface SorareRefreshPlan {
  scores: boolean;
  classic: boolean;
  inSeason: boolean;
}

function fresh(value: Date | null, now: number): boolean {
  return Boolean(value && value.getTime() > now);
}

export function sorareRefreshPlan(
  cache: SorareCacheFreshness | null | undefined,
  now = Date.now(),
  force = false,
): SorareRefreshPlan {
  return {
    scores: force || !cache || !fresh(cache.scoresExpiresAt, now),
    classic: force || !cache || !fresh(cache.classicExpiresAt, now),
    inSeason: force || !cache || !fresh(cache.inSeasonExpiresAt, now),
  };
}
