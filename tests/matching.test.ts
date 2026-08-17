/**
 * Tests del matching CERRADO contra roster (módulo `lib/match.ts`).
 *
 * Estos tests verifican el comportamiento del matcher puro, sin tocar la
 * BD. La integración con la BD se valida por separado mediante el script
 * `scripts/audit-duplicates.ts` (que ejecuta contra los datos reales).
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { matchAgainstRoster } from "../lib/match";

describe("matchAgainstRoster", () => {
  const roster = [
    { name: "Ademola Lookman", pos: "DEL" as const },
    { name: "Bil Nsongo", pos: "DEL" as const },
    { name: "Lorenzo Amatucci", pos: "MED" as const },
    { name: "Pierre-Emerick Aubameyang", pos: "DEL" as const },
    { name: "Gorka Guruzeta", pos: "DEL" as const },
    { name: "Kylian Mbappé", pos: "DEL" as const },
    { name: "Jude Bellingham", pos: "MED" as const },
    { name: "Pedri", pos: "MED" as const },
  ];

  it("caso del screenshot: 4 fuentes, 1 con nombre completo + 3 con apellido solo → 1 único player_id", () => {
    // 3 fuentes escriben solo "Lookman"; 1 escribe el nombre completo.
    const indices = new Set<number>();
    for (let i = 0; i < 3; i++) {
      const m = matchAgainstRoster("Lookman", roster);
      expect(m).not.toBeNull();
      indices.add(m!.index);
    }
    const fullMatch = matchAgainstRoster("Ademola Lookman", roster);
    expect(fullMatch).not.toBeNull();
    indices.add(fullMatch!.index);
    // Las 4 entradas convergen en el mismo índice del roster.
    expect(indices.size).toBe(1);
  });

  const casos: Array<{ input: string; expected: string }> = [
    { input: "Lookman", expected: "Ademola Lookman" },
    { input: "Nsongo", expected: "Bil Nsongo" },
    { input: "Amatucci", expected: "Lorenzo Amatucci" },
    { input: "Aubameyang", expected: "Pierre-Emerick Aubameyang" },
    { input: "Guruzeta", expected: "Gorka Guruzeta" },
    { input: "Mbappé", expected: "Kylian Mbappé" },
    { input: "Bellingham", expected: "Jude Bellingham" },
    { input: "Pedri", expected: "Pedri" },
    { input: "Ademola Lookman", expected: "Ademola Lookman" },
    { input: "Bil Nsongo", expected: "Bil Nsongo" },
    // Sin tilde.
    { input: "Mbappe", expected: "Kylian Mbappé" },
    // Solo primer nombre.
    { input: "Ademola", expected: "Ademola Lookman" },
  ];

  for (const c of casos) {
    it(`"${c.input}" → "${c.expected}"`, () => {
      const m = matchAgainstRoster(c.input, roster);
      expect(m).not.toBeNull();
      expect(roster[m!.index].name).toBe(c.expected);
    });
  }

  it("rechaza entradas que no están en el roster", () => {
    expect(matchAgainstRoster("Lionel Messi", roster)).toBeNull();
    expect(matchAgainstRoster("Cristiano Ronaldo", roster)).toBeNull();
  });

  it("rechaza cuando hay ambigüedad (Williams vs Williams: solo hay un Williams aquí, pero si hubiera 2)", () => {
    const rosterCon2Williams = [
      { name: "Iñaki Williams", pos: "DEL" as const },
      { name: "Nico Williams", pos: "DEL" as const },
    ];
    expect(matchAgainstRoster("Williams", rosterCon2Williams)).toBeNull();
  });
});
