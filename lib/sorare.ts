import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SorarePlayerData } from "@/lib/sorare-types";

export type { SorareCardPrice, SorarePlayerData } from "@/lib/sorare-types";

/**
 * Lee exclusivamente el cache persistente. Esta función se usa en Server
 * Components y route handlers; nunca contiene el cliente GraphQL ni hace
 * llamadas externas al abrir una pantalla.
 */
export async function getSorareData(slugs: string[]): Promise<Map<string, SorarePlayerData>> {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  const result = new Map<string, SorarePlayerData>();
  if (!uniqueSlugs.length) return result;

  const supabase = await createClient();
  const { data } = await supabase
    .from("sorare_player_cache")
    .select(
      "sorare_slug, display_name, first_name, last_name, birth_day, nationality, active_club_name, active_club_slug, scores, average_score, latest_score, scores_updated_at, classic_price_eur_cents, classic_card_slug, classic_updated_at, in_season_price_eur_cents, in_season_card_slug, in_season_updated_at, updated_at",
    )
    .in("sorare_slug", uniqueSlugs);

  for (const row of (data ?? []) as Array<{
    sorare_slug: string;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    birth_day: string | null;
    nationality: string | null;
    active_club_name: string | null;
    active_club_slug: string | null;
    scores: unknown;
    average_score: number | null;
    latest_score: number | null;
    scores_updated_at: string | null;
    classic_price_eur_cents: number | null;
    classic_card_slug: string | null;
    classic_updated_at: string | null;
    in_season_price_eur_cents: number | null;
    in_season_card_slug: string | null;
    in_season_updated_at: string | null;
    updated_at: string;
  }>) {
    const scores = Array.isArray(row.scores)
      ? row.scores.filter((score): score is number => typeof score === "number" && Number.isFinite(score))
      : [];
    result.set(row.sorare_slug, {
      slug: row.sorare_slug,
      displayName: row.display_name,
      firstName: row.first_name,
      lastName: row.last_name,
      birthDay: row.birth_day,
      nationality: row.nationality,
      activeClubName: row.active_club_name,
      activeClubSlug: row.active_club_slug,
      scores,
      averageScore: row.average_score,
      latestScore: row.latest_score,
      scoresUpdatedAt: row.scores_updated_at,
      classic: {
        eurCents: row.classic_price_eur_cents,
        cardSlug: row.classic_card_slug,
        updatedAt: row.classic_updated_at,
      },
      inSeason: {
        eurCents: row.in_season_price_eur_cents,
        cardSlug: row.in_season_card_slug,
        updatedAt: row.in_season_updated_at,
      },
      fetchedAt: row.updated_at,
    });
  }
  return result;
}
