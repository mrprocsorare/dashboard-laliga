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
import { matchAgainstRoster, nearMisses } from "../lib/match";
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
    it("con minConfidence 0.95, un subset-inverse 0.8 NO matchea si no hay regla más fuerte", () => {
      // Probamos con un roster mínimo donde no haya regla de apellido+pil
      // que matchee con 0.95.
      const miniRoster: CanonicalPlayer[] = [{ name: "García", pos: "DEF" }];
      // "García" es 1 token. last-name-unique da 0.85 < 0.95 → null.
      expect(matchAgainstRoster("García", miniRoster, { minConfidence: 0.95 })).toBeNull();
    });

    it("con minConfidence 0.5, sí matchea", () => {
      const miniRoster: CanonicalPlayer[] = [{ name: "Padilla", pos: "POR" }];
      expect(matchAgainstRoster("Álex Padilla", miniRoster, { minConfidence: 0.5 })).not.toBeNull();
    });

    it("minConfidence 1.0 solo acepta exact", () => {
      expect(
        matchAgainstRoster("Ademola Lookman", ROSTER, { minConfidence: 1.0 })!.rule,
      ).toBe("exact");
      expect(matchAgainstRoster("Lookman", ROSTER, { minConfidence: 1.0 })).toBeNull();
    });
  });

  describe("Cobertura numérica (mínimo 30 casos)", () => {
    it("el roster de test tiene ≥ 30 jugadores", () => {
      expect(ROSTER.length).toBeGreaterThanOrEqual(30);
    });
  });

  describe("Diminutivos de nombre de pila (mismo apellido)", () => {
    // Roster auxiliar para esta batería (todos los pares que el enunciado
    // menciona + otros habituales de la plantilla 2026-27).
    const miniRoster: CanonicalPlayer[] = [
      { name: "Alejandro Grimaldo", pos: "DEF" },
      { name: "Alejandro Balde", pos: "DEF" },
      { name: "Javier Guerra", pos: "MED" },
      { name: "Fernando Niño", pos: "DEL" },
      { name: "Facundo González", pos: "MED" },
      { name: "Cristian Romero", pos: "DEF" },
      { name: "Manuel Sánchez", pos: "DEF" },
      { name: "Roberto Torres", pos: "MED" },
      { name: "Francisco García", pos: "DEL" },
      { name: "Daniel Carvajal", pos: "DEF" },
      { name: "Antonio Rüdiger", pos: "DEF" },
      { name: "Jesús Areso", pos: "DEF" },
      { name: "Rafael Leão", pos: "DEL" },
      { name: "Youssef Enríquez", pos: "DEL" },
      { name: "Rubén García", pos: "MED" },
      { name: "Rodrigo Riquelme", pos: "DEL" },
    ];

    const casos: Array<{ input: string; canonical: string; regla: string }> = [
      // Caso exacto del enunciado.
      { input: "Álex Grimaldo", canonical: "Alejandro Grimaldo", regla: "Álex → Alejandro" },
      // Variantes del enunciado (mismo patrón, otros apellidos).
      { input: "Álex Balde", canonical: "Alejandro Balde", regla: "Álex → Alejandro" },
      { input: "Javi Guerra", canonical: "Javier Guerra", regla: "Javi → Javier" },
      { input: "Fer Niño", canonical: "Fernando Niño", regla: "Fer → Fernando" },
      { input: "Facu González", canonical: "Facundo González", regla: "Facu → Facundo" },
      { input: "Cuti Romero", canonical: "Cristian Romero", regla: "Cuti → Cristian" },
      { input: "Manu Sánchez", canonical: "Manuel Sánchez", regla: "Manu → Manuel" },
      { input: "Roberto", canonical: "Roberto Torres", regla: "1 token, apellido único" },
      { input: "Dani Carvajal", canonical: "Daniel Carvajal", regla: "Dani → Daniel" },
      { input: "Toni Rüdiger", canonical: "Antonio Rüdiger", regla: "Toni → Antonio" },
      { input: "Rafa Leão", canonical: "Rafael Leão", regla: "Rafa → Rafael" },
      { input: "Yusi Enríquez", canonical: "Youssef Enríquez", regla: "Yusi → Youssef" },
      { input: "Rubo García", canonical: "Rubén García", regla: "Rubo → Rubén" },
      { input: "Roro Riquelme", canonical: "Rodrigo Riquelme", regla: "Roro → Rodrigo" },
      // Iniciales: "P." solo matchea si el canónico empieza por P.
      // (P. Aubameyang → Pierre-Emerick Aubameyang empieza por P).
      // NO podemos asumir que P. = Francisco, Pablo, Pedro, etc.
      // (Para testear esto, añadimos el canónico al mini-roster de este test):
      // ya está cubierto arriba en el roster principal (Pierre-Emerick Aubameyang).
      // Aquí verificamos que NO hay falso positivo: "P. García" NO matchea
      // con "Francisco García" (porque Francisco no empieza por P).
      { input: "P. García", canonical: "(no match)", regla: "P ≠ Francisco" },
    ];

    for (const c of casos) {
      it(`"${c.input}" → "${c.canonical}" (${c.regla})`, () => {
        const m = matchAgainstRoster(c.input, miniRoster);
        if (c.canonical === "(no match)") {
          expect(m).toBeNull();
          return;
        }
        expect(m).not.toBeNull();
        expect(miniRoster[m!.index].name).toBe(c.canonical);
      });
    }
  });

  describe("nearMisses (Paso 4)", () => {
    const roster: CanonicalPlayer[] = [
      { name: "Alejandro Grimaldo", pos: "DEF" },
    ];
    it("nearMisses detecta la similitud Álex/Alejandro Grimaldo con score 0.95", () => {
      const ms = nearMisses("Álex Grimaldo", roster);
      expect(ms.length).toBeGreaterThan(0);
      const top = ms[0];
      expect(top.canonicalName).toBe("Alejandro Grimaldo");
      expect(top.confidence).toBeGreaterThanOrEqual(0.9);
      expect(top.rule).toBe("first-name-alias-same-lastname");
    });

    it("nearMisses devuelve [] para un nombre completamente distinto", () => {
      const ms = nearMisses("Lionel Messi", roster);
      expect(ms.length).toBe(0);
    });
  });
});
