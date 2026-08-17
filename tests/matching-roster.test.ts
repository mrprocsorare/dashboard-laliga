/**
 * Tests exhaustivos del matching CERRADO contra el roster canónico.
 *
 * 30+ casos sintéticos que cubren:
 *  - Nombre completo vs solo apellido.
 *  - Apellido con/sin tilde.
 *  - Apellidos con partículas (Ruiz de Galarreta).
 *  - Nombres con guión (Pierre-Emerick).
 *  - Dos jugadores del mismo equipo que comparten apellido (defensa contra
 *    falsos positivos: Williams, García).
 *  - Casos negativos (un nombre que NO está en el roster).
 *  - Diferentes reglas (exact, subset-inverse, subset-canon, last-name-unique).
 *  - minConfidence customizable.
 */
import { describe, it, expect } from "vitest";
import { matchAgainstRoster } from "../lib/match";
import type { CanonicalPlayer } from "../lib/roster";

const ROSTER: CanonicalPlayer[] = [
  // Athletic Club
  { name: "Unai Simón", pos: "POR" },
  { name: "Álex Padilla", pos: "POR" },
  { name: "Dani Vivian", pos: "DEF" },
  { name: "Yeray Álvarez", pos: "DEF" },
  { name: "Jesús Areso", pos: "DEF" },
  { name: "Aymeric Laporte", pos: "DEF" },
  { name: "Yuri Berchiche", pos: "DEF" },
  { name: "Oihan Sancet", pos: "MED" },
  { name: "Iñigo Ruiz de Galarreta", pos: "MED" },
  { name: "Beñat Prados", pos: "MED" },
  { name: "Iñaki Williams", pos: "DEL" },
  { name: "Nico Williams", pos: "DEL" },
  { name: "Gorka Guruzeta", pos: "DEL" },
  { name: "Álex Berenguer", pos: "DEL" },
  // Real Madrid
  { name: "Thibaut Courtois", pos: "POR" },
  { name: "Antonio Rüdiger", pos: "DEF" },
  { name: "Dani Carvajal", pos: "DEF" },
  { name: "Federico Valverde", pos: "MED" },
  { name: "Jude Bellingham", pos: "MED" },
  { name: "Vinícius Júnior", pos: "DEL" },
  { name: "Kylian Mbappé", pos: "DEL" },
  // Barcelona
  { name: "Joan Garcia", pos: "POR" },
  { name: "Alejandro Balde", pos: "DEF" },
  { name: "Pau Cubarsí", pos: "DEF" },
  { name: "Jules Koundé", pos: "DEF" },
  { name: "Pedri", pos: "MED" },
  { name: "Fermín López Marín", pos: "MED" },
  { name: "Lamine Yamal", pos: "DEL" },
  { name: "Raphinha", pos: "DEL" },
  // Atlético
  { name: "Jan Oblak", pos: "POR" },
  { name: "Koke Resurrección", pos: "MED" },
  { name: "Julián Alvarez", pos: "DEL" },
  { name: "Antoine Griezmann", pos: "DEL" },
  // Deportivo
  { name: "Bil Nsongo", pos: "DEL" },
  { name: "Lorenzo Amatucci", pos: "MED" },
  { name: "Pierre-Emerick Aubameyang", pos: "DEL" },
  { name: "Bright Ede", pos: "DEF" },
  // Villarreal
  { name: "Gerard Moreno", pos: "DEL" },
  { name: "Denis Suárez", pos: "MED" },
  // Atlético (extra: para validar Lookman alias)
  { name: "Ademola Lookman", pos: "DEL" },
];

describe("matchAgainstRoster — matching cerrado", () => {
  describe("Casos positivos: variantes resuelven al canónico", () => {
    const positivos: Array<{ input: string; canonical: string }> = [
      // Apellido solo.
      { input: "Guruzeta", canonical: "Gorka Guruzeta" },
      { input: "Nsongo", canonical: "Bil Nsongo" },
      { input: "Bellingham", canonical: "Jude Bellingham" },
      { input: "Courtois", canonical: "Thibaut Courtois" },
      { input: "Berenguer", canonical: "Álex Berenguer" },
      { input: "Rüdiger", canonical: "Antonio Rüdiger" },
      { input: "Oblak", canonical: "Jan Oblak" },
      { input: "Valverde", canonical: "Federico Valverde" },
      { input: "Laporte", canonical: "Aymeric Laporte" },
      { input: "Sancet", canonical: "Oihan Sancet" },
      { input: "Berchiche", canonical: "Yuri Berchiche" },
      { input: "Vivian", canonical: "Dani Vivian" },
      { input: "Padilla", canonical: "Álex Padilla" },
      { input: "Carvajal", canonical: "Dani Carvajal" },
      { input: "Cubarsí", canonical: "Pau Cubarsí" },
      { input: "Koundé", canonical: "Jules Koundé" },
      { input: "Raphinha", canonical: "Raphinha" },
      { input: "Ede", canonical: "Bright Ede" },
      { input: "Moreno", canonical: "Gerard Moreno" },
      { input: "Griezmann", canonical: "Antoine Griezmann" },
      // Con/sin tilde.
      { input: "Julián Álvarez", canonical: "Julián Alvarez" },
      { input: "Yeray", canonical: "Yeray Álvarez" },
      // Nombre exacto.
      { input: "Gorka Guruzeta", canonical: "Gorka Guruzeta" },
      { input: "Bil Nsongo", canonical: "Bil Nsongo" },
      { input: "Pedri", canonical: "Pedri" },
      { input: "Vinícius Júnior", canonical: "Vinícius Júnior" },
      // Apellidos con partículas.
      { input: "Ruiz de Galarreta", canonical: "Iñigo Ruiz de Galarreta" },
      // Guión.
      { input: "Aubameyang", canonical: "Pierre-Emerick Aubameyang" },
      // Mbappé con/sin tilde.
      { input: "Mbappé", canonical: "Kylian Mbappé" },
      { input: "Mbappe", canonical: "Kylian Mbappé" },
      // Solo primer nombre.
      { input: "Lamine", canonical: "Lamine Yamal" },
      { input: "Ademola", canonical: "Ademola Lookman" },
      // Apellido único sin ambigüedad.
      { input: "Amatucci", canonical: "Lorenzo Amatucci" },
      { input: "Lookman", canonical: "Ademola Lookman" },
      { input: "Prados", canonical: "Beñat Prados" },
      { input: "Areso", canonical: "Jesús Areso" },
      // Iniciales.
      { input: "A. Balde", canonical: "Alejandro Balde" },
      // Nombre con segundo apellido.
      { input: "Fermín López", canonical: "Fermín López Marín" },
      { input: "Denis Suárez", canonical: "Denis Suárez" },
      // Variantes ortográficas.
      { input: "Balde", canonical: "Alejandro Balde" },
      { input: "Yamal", canonical: "Lamine Yamal" },
      { input: "Lamine Yamal", canonical: "Lamine Yamal" },
      // Acentos.
      { input: "Koke", canonical: "Koke Resurrección" },
      { input: "Resurrección", canonical: "Koke Resurrección" },
      // Solo "Denis" no matchea porque solo hay 1 jugador con Denis y el
      // matching por apellido único exigiría 1 token. Aquí lo verificamos
      // positivo con el input completo.
      { input: "Denis", canonical: "Denis Suárez" },
    ];

    for (const c of positivos) {
      it(`"${c.input}" → "${c.canonical}"`, () => {
        const m = matchAgainstRoster(c.input, ROSTER);
        expect(m).not.toBeNull();
        expect(ROSTER[m!.index].name).toBe(c.canonical);
      });
    }
  });

  describe("Casos defensivos: NO falsea positivos", () => {
    const negativos: Array<{ input: string; motivo: string }> = [
      { input: "Williams", motivo: "hay 2 Williams en el roster" },
      { input: "Iago Aspas", motivo: "no está en este roster de test" },
      { input: "Lionel Messi", motivo: "no está en el roster" },
      { input: "Cristiano Ronaldo", motivo: "no está en el roster" },
      { input: "Laporte Williams", motivo: "mezcla tokens de 2 jugadores" },
      { input: "Mbappé Guruzeta", motivo: "mezcla tokens de 2 jugadores" },
      // "García" SÍ matchea (con "Joan Garcia", apellido normalizado "garcia")
      // porque hay UN jugador con ese apellido. Por eso no está en negativos.
    ];

    for (const c of negativos) {
      it(`"${c.input}" → null (${c.motivo})`, () => {
        expect(matchAgainstRoster(c.input, ROSTER)).toBeNull();
      });
    }
  });

  describe("Reglas: las correctas se aplican", () => {
    it("Lookman (1 token, apellido único) → last-name-unique con 'Ademola Lookman'", () => {
      const m = matchAgainstRoster("Lookman", ROSTER);
      expect(m).not.toBeNull();
      expect(m!.rule).toBe("last-name-unique");
      expect(ROSTER[m!.index].name).toBe("Ademola Lookman");
    });

    it("Ademola Lookman (input completo) → exact", () => {
      const m = matchAgainstRoster("Ademola Lookman", ROSTER);
      expect(m).not.toBeNull();
      expect(m!.rule).toBe("exact");
    });

    it("Padilla (1 token, apellido único) → last-name-unique", () => {
      const m = matchAgainstRoster("Padilla", ROSTER);
      expect(m).not.toBeNull();
      expect(m!.rule).toBe("last-name-unique");
    });

    it("Williams (1 token, 2 candidatos) → null (ambigüedad)", () => {
      const m = matchAgainstRoster("Williams", ROSTER);
      expect(m).toBeNull();
    });
  });

  describe("minConfidence customizable", () => {
    it("con minConfidence 0.95, un subset-inverse 0.8 NO matchea", () => {
      const m = matchAgainstRoster("Padilla", ROSTER, { minConfidence: 0.95 });
      expect(m).toBeNull();
    });

    it("con minConfidence 0.5, sí matchea", () => {
      const m = matchAgainstRoster("Padilla", ROSTER, { minConfidence: 0.5 });
      expect(m).not.toBeNull();
    });

    it("minConfidence 1.0 solo acepta exact", () => {
      expect(matchAgainstRoster("Ademola Lookman", ROSTER, { minConfidence: 1.0 })!.rule).toBe("exact");
      expect(matchAgainstRoster("Lookman", ROSTER, { minConfidence: 1.0 })).toBeNull();
    });
  });

  describe("Cobertura numérica (mínimo 30 casos)", () => {
    it("el roster de test tiene ≥ 30 jugadores", () => {
      expect(ROSTER.length).toBeGreaterThanOrEqual(30);
    });
  });
});
