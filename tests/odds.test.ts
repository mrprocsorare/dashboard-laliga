import { describe, expect, it } from "vitest";
import { normalizeThreeWayOdds } from "../lib/odds";

describe("The Odds API probability normalization", () => {
  it("removes the simple bookmaker margin from decimal 1X2 odds", () => {
    const result = normalizeThreeWayOdds(2, 3, 4);
    expect(result).toEqual({ home: 46, draw: 31, away: 23 });
  });

  it("returns null for incomplete or invalid odds", () => {
    expect(normalizeThreeWayOdds(2, 0, 4)).toBeNull();
    expect(normalizeThreeWayOdds(Number.NaN, 3, 4)).toBeNull();
  });

  it("supports an event without odds without inventing probabilities", () => {
    const result = normalizeThreeWayOdds(0, 0, 0);
    expect(result).toBeNull();
  });
});
