import { describe, expect, it } from "vitest";
import { SorareApiClient, SorareBudgetExceededError, SORARE_PLAYER_QUERY } from "../lib/sorare-client";
import { decideSorareMatch, decideSlugProbeMatch, type SorareCandidate } from "../lib/sorare-matching";
import { sorareRefreshPlan } from "../lib/sorare-sync-policy";

const pedri: SorareCandidate = {
  slug: "pedro-gonzalez-lopez",
  displayName: "Pedri",
  firstName: "Pedri",
  lastName: "",
  birthDay: "2002-11-25",
  nationality: "es",
  activeClubName: "FC Barcelona",
  activeClubSlug: "barcelona-barcelona",
};

function playerPayload(slugs: string[]) {
  return {
    data: {
      players: slugs.map((slug) => ({
        ...pedri,
        slug,
        playerGameScores: [{ score: 60 }],
        classic: { slug: `${slug}-classic`, publicMinPrices: { eurCents: 1000 }, liveSingleSaleOffer: null, latestEnglishAuction: null },
        inSeason: { slug: `${slug}-season`, publicMinPrices: { eurCents: 2000 }, liveSingleSaleOffer: null, latestEnglishAuction: null },
      })),
    },
  };
}

describe("matching Sorare por identidad", () => {
  it("acepta nombre, club y fecha de nacimiento coherentes", () => {
    const decision = decideSorareMatch(
      { id: "1", name: "Pedri", teamName: "Barcelona", dateOfBirth: "2002-11-25", nationality: "es" },
      [pedri],
    );
    expect(decision.status).toBe("matched");
    expect(decision.method).toBe("name_club_birth_day");
  });

  it("no convierte un nombre ambiguo en falso positivo", () => {
    const decision = decideSorareMatch(
      { id: "1", name: "García", teamName: "Barcelona" },
      [
        { ...pedri, slug: "garcia-a", displayName: "García", firstName: "A", lastName: "García" },
        { ...pedri, slug: "garcia-b", displayName: "García", firstName: "B", lastName: "García" },
      ],
    );
    expect(decision.status).toBe("manual_review");
  });

  it("exige club cuando la evidencia solo es nominal", () => {
    const decision = decideSorareMatch(
      { id: "1", name: "Pedri", teamName: "Athletic Club" },
      [pedri],
    );
    expect(decision.status).toBe("manual_review");
  });
});

describe("cliente Sorare con límites", () => {
  it("mantiene Classic e In-Season separados y no usa campos obsoletos", () => {
    expect(SORARE_PLAYER_QUERY).toContain("classic: lowestPriceAnyCard(inSeason: false, rarity: limited)");
    expect(SORARE_PLAYER_QUERY).toContain("inSeason: lowestPriceAnyCard(inSeason: true, rarity: limited)");
    expect(SORARE_PLAYER_QUERY).toContain("playerGameScores(last: 5) { score }");
    expect(SORARE_PLAYER_QUERY).not.toContain("game {");
  });

  it("agrupa jugadores en lotes de 20 y deduplica consultas iguales", async () => {
    const calls: string[] = [];
    const client = new SorareApiClient({
      budget: 3,
      requestsPerMinute: 1000,
      minIntervalMs: 0,
      sleep: async () => undefined,
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { variables: { slugs: string[] } };
        calls.push(body.variables.slugs.join(","));
        return new Response(JSON.stringify(playerPayload(body.variables.slugs)), { status: 200 });
      },
    });
    const [first, second] = await Promise.all([
      client.getPlayers(["a", "b"]),
      client.getPlayers(["a", "b"]),
    ]);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it("respeta Retry-After antes de reintentar un 429", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = new SorareApiClient({
      budget: 3,
      requestsPerMinute: 1000,
      minIntervalMs: 0,
      sleep: async (ms) => { sleeps.push(ms); },
      fetcher: async () => {
        calls++;
        if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "2" } });
        return new Response(JSON.stringify(playerPayload(["a"])), { status: 200 });
      },
    });
    await expect(client.getPlayers(["a"])).resolves.toHaveLength(1);
    expect(calls).toBe(2);
    expect(sleeps).toContain(2000);
  });

  it("se detiene al agotar el presupuesto interno", async () => {
    const client = new SorareApiClient({
      budget: 1,
      requestsPerMinute: 1000,
      minIntervalMs: 0,
      sleep: async () => undefined,
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { variables: { slugs: string[] } };
        return new Response(JSON.stringify(playerPayload(body.variables.slugs)), { status: 200 });
      },
    });
    await expect(client.getPlayers(Array.from({ length: 21 }, (_, index) => `player-${index}`))).rejects.toBeInstanceOf(SorareBudgetExceededError);
  });
});

describe("TTL independiente", () => {
  it("refresca solo los grupos caducados", () => {
    const now = Date.now();
    const plan = sorareRefreshPlan({
      scoresExpiresAt: new Date(now + 10_000),
      classicExpiresAt: new Date(now - 1),
      inSeasonExpiresAt: new Date(now + 10_000),
    }, now);
    expect(plan).toEqual({ scores: false, classic: true, inSeason: false });
  });
});

describe("decideSlugProbeMatch", () => {
  const budimir: SorareCandidate = {
    slug: "ante-budimir",
    displayName: "Ante Budimir",
    firstName: "Ante",
    lastName: "Budimir",
    birthDay: "1991-07-22",
    nationality: "hr",
    activeClubName: "CA Osasuna",
    activeClubSlug: "osasuna",
  };

  it("matchea por slug exacto con nombre coincidente", () => {
    const decision = decideSlugProbeMatch(
      { id: "1", name: "Ante Budimir", teamName: "CA Osasuna" },
      [budimir],
      ["ante-budimir"],
    );
    expect(decision.status).toBe("matched");
    expect(decision.method).toBe("slug_probe_exact");
    expect(decision.candidate?.slug).toBe("ante-budimir");
  });

  it("matchea por slug exacto aunque el nombre sea parcialmente diferente", () => {
    const kubo: SorareCandidate = {
      slug: "takefusa-kubo",
      displayName: "Take Kubo",
      firstName: "Take",
      lastName: "Kubo",
      birthDay: "2001-06-04",
      nationality: "jp",
      activeClubName: "Real Sociedad",
      activeClubSlug: "real-sociedad",
    };
    const decision = decideSlugProbeMatch(
      { id: "1", name: "Takefusa Kubo", teamName: "Real Sociedad" },
      [kubo],
      ["takefusa-kubo", "take-kubo", "kubo"],
    );
    expect(decision.status).toBe("matched");
    expect(decision.method).toBe("slug_probe_exact");
  });

  it("matchea por nombre alto sin slug exacto", () => {
    const decision = decideSlugProbeMatch(
      { id: "1", name: "Ante Budimir", teamName: "CA Osasuna" },
      [{ ...budimir, slug: "antebudimir" }],
      ["ante-budimir", "budimir"],
    );
    expect(decision.status).toBe("matched");
    expect(decision.method).toBe("slug_probe_name");
  });

  it("devuelve not_found sin candidatos", () => {
    const decision = decideSlugProbeMatch(
      { id: "1", name: "Jugador Fantasma", teamName: "Barcelona" },
      [],
      ["jugador-fantasma"],
    );
    expect(decision.status).toBe("not_found");
  });

  it("marca manual_review cuando el nombre no coincide", () => {
    const decision = decideSlugProbeMatch(
      { id: "1", name: "Pedri Gonzalez", teamName: "Barcelona" },
      [{ ...budimir, slug: "pedri-gonzalez" }],
      ["pedri-gonzalez"],
    );
    expect(decision.status).toBe("manual_review");
  });

  it("acepta nombres abreviados via prefix matching", () => {
    const take: SorareCandidate = {
      slug: "take-kubo",
      displayName: "Take Kubo",
      firstName: "Take",
      lastName: "Kubo",
      birthDay: "2001-06-04",
      nationality: "jp",
      activeClubName: "Real Sociedad",
      activeClubSlug: "real-sociedad",
    };
    const decision = decideSlugProbeMatch(
      { id: "1", name: "Takefusa Kubo", teamName: "Real Sociedad" },
      [take],
      ["takefusa-kubo", "take-kubo"],
    );
    expect(decision.status).toBe("matched");
  });
});
