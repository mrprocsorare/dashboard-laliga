import { describe, expect, it } from "vitest";
import { parseMatchPage } from "../scrapers/sources/biwenger/parser";

describe("Biwenger parser", () => {
  it("parsea la estructura actual por columnas home/away", () => {
    const html = `
      <section id="main">
        <div itemprop="homeTeam"><h4 itemprop="name">Alavés</h4></div>
        <div itemprop="awayTeam"><h4 itemprop="name">Getafe</h4></div>
        <div id="team">
          <div class="match-team-inner">
            <div itemprop="performer">
              <div class="player-position" title="Portero">PT</div>
              <img itemprop="image" src="https://cdn.example/sivera.png?size=40">
              <h4 itemprop="name">Sivera</h4>
            </div>
            <div itemprop="performer">
              <div class="player-position" title="Portero">PT</div>
              <img itemprop="image" src="https://cdn.example/soria.png">
              <h4 itemprop="name">David Soria</h4>
            </div>
          </div>
          <div class="match-team-inner">
            <div itemprop="performer">
              <div class="player-position" title="Defensa">DF</div>
              <h4 itemprop="name">Jonny Castro</h4>
            </div>
            <div itemprop="performer">
              <div class="player-position" title="Defensa">DF</div>
              <h4 itemprop="name">Zaid Romero</h4>
            </div>
          </div>
        </div>
      </section>`;

    const result = parseMatchPage(html);

    expect(result.local?.teamSlug).toBe("alaves");
    expect(result.visitante?.teamSlug).toBe("getafe");
    expect(result.local?.players).toHaveLength(2);
    expect(result.visitante?.players).toHaveLength(2);
    expect(result.local?.players[0]).toMatchObject({ name: "Sivera", position: "POR" });
    expect(result.local?.players[0].photoUrl).toBe("https://cdn.example/sivera.png");
    expect(result.local?.players[1]).toMatchObject({ name: "Jonny Castro", position: "DEF" });
    expect(result.visitante?.players[0]).toMatchObject({ name: "David Soria", position: "POR" });
  });

  it("deduplica tarjetas repetidas del mismo jugador", () => {
    const html = `
      <section id="main">
        <div itemprop="homeTeam"><h4 itemprop="name">Alavés</h4></div>
        <div itemprop="awayTeam"><h4 itemprop="name">Getafe</h4></div>
        <div id="team">
          <div class="match-team-inner">
            <div itemprop="performer"><div class="player-position" title="Portero"></div><h4 itemprop="name">Sivera</h4></div>
            <div itemprop="performer"><div class="player-position" title="Portero"></div><h4 itemprop="name">David Soria</h4></div>
          </div>
          <div class="match-team-inner">
            <div itemprop="performer"><div class="player-position" title="Portero"></div><h4 itemprop="name">Sivera</h4></div>
            <div itemprop="performer"><div class="player-position" title="Portero"></div><h4 itemprop="name">David Soria</h4></div>
          </div>
        </div>
      </section>`;

    const result = parseMatchPage(html);
    expect(result.local?.players.map((p) => p.name)).toEqual(["Sivera"]);
    expect(result.visitante?.players.map((p) => p.name)).toEqual(["David Soria"]);
  });
});
