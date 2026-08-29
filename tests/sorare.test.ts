import { describe, expect, it, vi } from "vitest";
import { SorareApiClient, SorareBudgetExceededError, SORARE_PLAYER_QUERY, priceFromSorareCard, computePlayerPrices, type SorarePlayerResponse } from "../lib/sorare-client";
import { decideSorareMatch, decideSlugProbeMatch, type SorareCandidate } from "../lib/sorare-matching";
import { slugVariants } from "../lib/sorare-slugs";
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

  it("matchea nombre abreviado con club y sin fecha de nacimiento (prefijo)", () => {
    const vinicius: SorareCandidate = {
      slug: "vinicius-jose-paixao-de-oliveira-junior",
      displayName: "Vinícius Júnior",
      firstName: "Vinícius",
      lastName: "Júnior",
      birthDay: "2000-07-12",
      nationality: "br",
      activeClubName: "Real Madrid",
      activeClubSlug: "real-madrid",
    };
    const decision = decideSorareMatch(
      { id: "1", name: "Vinícius Jr", teamName: "Real Madrid" },
      [vinicius],
    );
    expect(decision.status).toBe("matched");
  });

  it("matchea por prefijo (Take -> Takefusa) con club y sin fecha", () => {
    const kubo: SorareCandidate = {
      slug: "takefusa-kubo",
      displayName: "Take Kubo",
      firstName: "Takefusa",
      lastName: "Kubo",
      birthDay: "2001-06-04",
      nationality: "jp",
      activeClubName: "Real Sociedad",
      activeClubSlug: "real-sociedad",
    };
    const decision = decideSorareMatch(
      { id: "1", name: "Take Kubo", teamName: "Real Sociedad" },
      [kubo],
    );
    expect(decision.status).toBe("matched");
  });
});

describe("slugVariants", () => {
  it("limpia basura tipo '{{Cita web' sin cierre", () => {
    const variants = slugVariants({ name: "Mikel Santos", canonicalName: "Mikel Santos {{Cita web" });
    expect(variants).toContain("mikel-santos");
    expect(variants.some((variant) => variant.includes("cita"))).toBe(false);
  });

  it("genera variantes para nombre con inicial", () => {
    const variants = slugVariants({ name: "S. Flores" });
    expect(variants).toContain("s-flores");
    expect(variants).toContain("flores");
  });

  it("no genera slugs vacíos por basura", () => {
    const variants = slugVariants({ name: "Mikel Santos", canonicalName: "{{Cita web" });
    expect(variants.length).toBeGreaterThan(0);
  });
});

describe("cliente Sorare con límites", () => {
  it("mantiene Classic e In-Season separados y no usa campos obsoletos", () => {
    expect(SORARE_PLAYER_QUERY).toContain("classic: lowestPriceAnyCard(inSeason: false, rarity: limited)");
    expect(SORARE_PLAYER_QUERY).toContain("inSeason: lowestPriceAnyCard(inSeason: true, rarity: limited)");
    expect(SORARE_PLAYER_QUERY).toContain("playerGameScores(last: 5) { score }");
    expect(SORARE_PLAYER_QUERY).not.toContain("game {");
  });

  it("pide receiverSide (precio pedido) en la oferta de venta", () => {
    expect(SORARE_PLAYER_QUERY).toContain("liveSingleSaleOffer { senderSide { amounts { eurCents } } receiverSide { amounts { eurCents } } }");
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

describe("precio de carta Sorare", () => {
  it("usa receiverSide (precio pedido) cuando publicMinPrices es null y senderSide vale 0", () => {
    const card = {
      slug: "x",
      publicMinPrices: null,
      liveSingleSaleOffer: {
        senderSide: { amounts: { eurCents: 0 } },
        receiverSide: { amounts: { eurCents: 180 } },
      },
      latestEnglishAuction: null,
    } as unknown as Parameters<typeof priceFromSorareCard>[0];
    expect(priceFromSorareCard(card)).toBe(180);
  });

  it("usa el bestBid de la subasta cuando no hay oferta de venta", () => {
    const card = {
      slug: "x",
      publicMinPrices: null,
      liveSingleSaleOffer: null,
      latestEnglishAuction: { bestBid: { amounts: { eurCents: 1524 } } },
    } as unknown as Parameters<typeof priceFromSorareCard>[0];
    expect(priceFromSorareCard(card)).toBe(1524);
  });

  it("ignora precios en 0 y devuelve null", () => {
    const card = {
      slug: "x",
      publicMinPrices: { eurCents: 0 },
      liveSingleSaleOffer: {
        senderSide: { amounts: { eurCents: 0 } },
        receiverSide: { amounts: { eurCents: 0 } },
      },
      latestEnglishAuction: { bestBid: { amounts: { eurCents: 0 } } },
    } as unknown as Parameters<typeof priceFromSorareCard>[0];
    expect(priceFromSorareCard(card)).toBeNull();
  });

  it("toma el mínimo entre fuentes y descarta publicMinPrices inflado", () => {
    const card = {
      slug: "x",
      publicMinPrices: { eurCents: 962 },
      liveSingleSaleOffer: {
        senderSide: { amounts: { eurCents: 0 } },
        receiverSide: { amounts: { eurCents: 42 } },
      },
      latestEnglishAuction: { bestBid: { amounts: { eurCents: 1000 } } },
    } as unknown as Parameters<typeof priceFromSorareCard>[0];
    expect(priceFromSorareCard(card)).toBe(42);
  });

  it("prefiere la mejor puja de subasta por debajo de la venta directa", () => {
    const card = {
      slug: "x",
      publicMinPrices: null,
      liveSingleSaleOffer: {
        senderSide: { amounts: { eurCents: 0 } },
        receiverSide: { amounts: { eurCents: 1500 } },
      },
      latestEnglishAuction: { bestBid: { amounts: { eurCents: 800 } } },
    } as unknown as Parameters<typeof priceFromSorareCard>[0];
    expect(priceFromSorareCard(card)).toBe(800);
  });
});

describe("computePlayerPrices (híbrido primaria + buscador de suelo)", () => {
  const basePlayer = (over: Partial<SorarePlayerResponse> = {}): SorarePlayerResponse => ({
    id: "1",
    slug: "gorka-guruzeta",
    displayName: "Gorka Guruzeta",
    firstName: "Gorka",
    lastName: "Guruzeta",
    birthDay: "2000-01-01",
    nationality: "es",
    activeClubName: null,
    activeClubSlug: null,
    playerGameScores: null,
    classic: null,
    inSeason: null,
    ...over,
  });

  const card = (over: Record<string, unknown> = {}): SorarePlayerResponse["classic"] => ({
    slug: "card",
    publicMinPrices: null,
    liveSingleSaleOffer: null,
    latestEnglishAuction: null,
    ...over,
  });

  const directSale = (eurCents: number) => ({
    liveSingleSaleOffer: {
      senderSide: { amounts: { eurCents: 0 } },
      receiverSide: { amounts: { eurCents } },
    },
  });

  const auction = (eurCents: number) => ({ latestEnglishAuction: { bestBid: { amounts: { eurCents } } } });

  it("usa la venta directa de lowestPriceAnyCard sin consultar el buscador", async () => {
    const player = basePlayer({
      classic: card({ ...directSale(180) }),
      inSeason: card({ ...directSale(500) }),
    });
    const floor = vi.fn(async () => ({ classic: { eurCents: 42, slug: "c" }, inSeason: { eurCents: 1168, slug: "i" } }));
    const client = { searchPlayerFloorPrices: floor } as unknown as SorareApiClient;
    const result = await computePlayerPrices(player, client, "gorka-guruzeta");
    expect(floor).not.toHaveBeenCalled();
    expect(result.classic.eurCents).toBe(180);
    expect(result.inSeason.eurCents).toBe(500);
  });

  it("recurre al buscador de suelo cuando lowestPriceAnyCard no trae venta directa (bug #644)", async () => {
    const player = basePlayer({
      classic: card({ ...auction(1000) }),
      inSeason: card({ ...directSale(500) }),
    });
    const floor = vi.fn(async () => ({ classic: { eurCents: 42, slug: "card-308" }, inSeason: { eurCents: 1168, slug: "i" } }));
    const client = { searchPlayerFloorPrices: floor } as unknown as SorareApiClient;
    const result = await computePlayerPrices(player, client, "gorka-guruzeta");
    expect(floor).toHaveBeenCalledWith("gorka-guruzeta");
    expect(result.classic.eurCents).toBe(42);
    expect(result.inSeason.eurCents).toBe(500);
  });

  it("usa la puja de subasta como último recurso si ni primaria ni buscador traen venta directa", async () => {
    const player = basePlayer({
      classic: card({ ...auction(1000) }),
      inSeason: card({ ...auction(1200) }),
    });
    const floor = vi.fn(async () => ({ classic: { eurCents: null, slug: null }, inSeason: { eurCents: null, slug: null } }));
    const client = { searchPlayerFloorPrices: floor } as unknown as SorareApiClient;
    const result = await computePlayerPrices(player, client, "gorka-guruzeta");
    expect(result.classic.eurCents).toBe(1000);
    expect(result.inSeason.eurCents).toBe(1200);
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
