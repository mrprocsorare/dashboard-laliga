export interface SorareCardPrice {
  eurCents: number | null;
  cardSlug: string | null;
  updatedAt: string | null;
}

export interface SorarePlayerData {
  slug: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDay: string | null;
  nationality: string | null;
  activeClubName: string | null;
  activeClubSlug: string | null;
  scores: number[];
  averageScore: number | null;
  latestScore: number | null;
  scoresUpdatedAt: string | null;
  classic: SorareCardPrice;
  inSeason: SorareCardPrice;
  fetchedAt: string;
}
