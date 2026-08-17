/**
 * Test del fix de duplicados. Reproduce EXACTAMENTE el escenario del
 * screenshot del dashboard:
 *
 *  - 4 fuentes (Comuniate, FutbolFantasy, AnalíticaFantasy, JornadaPerfecta).
 *  - 1 de ellas (FutbolFantasy) publica el nombre completo
 *    ("Ademola Lookman").
 *  - Las otras 3 publican solo el apellido ("Lookman").
 *  - Las 4 entradas deben acabar en el MISMO `player_id`.
 *
 * También cubre los otros 5 casos identificados en la auditoría
 * (Amatucci, Aubameyang, Pedri, Bellingham, Mbappé) para evitar
 * regresiones futuras.
 *
 * Se ejecuta contra la BD real con un equipo de test aislado (`laliga-test`)
 * que se crea/borra al inicio y al final del test.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { persistScraperResult } from "../services/persist";
import type { ScraperResult } from "../scrapers/types";
import { canonicalizeName, isSamePlayer, isSameLastNameReference, normalizeName } from "../services/player-names";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TEST_TEAM_SLUG = "laliga-test-lookman";
const TEST_SOURCE_SLUGS = ["test-comuniate", "test-futbolfantasy", "test-analiticafantasy", "test-jornadaperfecta"];

async function cleanup() {
  await pool.query(
    `DELETE FROM latest_player_forecast WHERE source_id IN (SELECT id FROM sources WHERE slug = ANY($1::text[]))`,
    [TEST_SOURCE_SLUGS],
  ).catch(() => undefined);
  for (const slug of TEST_SOURCE_SLUGS) {
    await pool.query("DELETE FROM sources WHERE slug = $1", [slug]).catch(() => undefined);
  }
  await pool.query("DELETE FROM players WHERE team_id IN (SELECT id FROM teams WHERE slug = $1)", [TEST_TEAM_SLUG]).catch(() => undefined);
  await pool.query("DELETE FROM teams WHERE slug = $1", [TEST_TEAM_SLUG]).catch(() => undefined);
}

async function setup() {
  await cleanup();
  await pool.query(
    `INSERT INTO teams (id, slug, name, short_name) VALUES (gen_random_uuid(), $1, 'Equipo Test', 'TEST')`,
    [TEST_TEAM_SLUG],
  );
  for (const slug of TEST_SOURCE_SLUGS) {
    await pool.query(
      `INSERT INTO sources (id, slug, name, base_url, enabled) VALUES (gen_random_uuid(), $1, $1, 'https://test', true)`,
      [slug],
    );
  }
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  errorWithCause: () => {},
};

describe("Unificación de nombres entre fuentes", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no definida");
    await setup();
  });
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  describe("Lógica pura (canonicalizeName + matching)", () => {
    const cases: Array<{ source: string; writtenBySource: string[] }> = [
      {
        source: "Lookman",
        writtenBySource: ["Ademola Lookman", "Lookman", "lookman", "ADEMOLA LOOKMAN"],
      },
      {
        source: "Aubameyang",
        writtenBySource: ["Pierre-Emerick Aubameyang", "Aubameyang", "aubameyang", "P. Aubameyang"],
      },
      {
        source: "Amatucci",
        writtenBySource: ["Lorenzo Amatucci", "Amatucci", "amatucci", "AMATUCCI"],
      },
      {
        source: "Pedri",
        writtenBySource: ["Pedro González", "Pedri", "pedro gonzalez", "PEDRO GONZÁLEZ"],
      },
      {
        source: "Bellingham",
        writtenBySource: ["Jude Bellingham", "Bellingham", "bellingham", "JUDE BELLINGHAM"],
      },
      {
        source: "Mbappé",
        writtenBySource: ["Kylian Mbappé", "Mbappé", "mbappe", "KYLIAN MBAPPÉ"],
      },
    ];

    for (const c of cases) {
      it(`canoniza todas las variantes de "${c.source}" al MISMO canónico (mismo normalized)`, () => {
        const canonicals = new Set(
          c.writtenBySource.map((v) => normalizeName(canonicalizeName(v))),
        );
        expect(canonicals.size).toBe(1);
      });

      it(`isSamePlayer colapsa las variantes de "${c.source}" entre sí`, () => {
        for (let i = 0; i < c.writtenBySource.length; i++) {
          for (let j = i + 1; j < c.writtenBySource.length; j++) {
            const a = c.writtenBySource[i];
            const b = c.writtenBySource[j];
            const canonA = canonicalizeName(a);
            const canonB = canonicalizeName(b);
            expect(
              isSamePlayer(a, b) || isSamePlayer(canonA, canonB),
              `Esperaba que "${a}" y "${b}" se identificaran como el mismo jugador`,
            ).toBe(true);
          }
        }
      });
    }

    it("NO confunde a los hermanos Williams (defensa contra falsos positivos)", () => {
      const nico = "Nico Williams";
      const inaki = "Iñaki Williams";
      // Ninguno está en PLAYER_ALIASES: el canónico de cada uno es él mismo.
      expect(canonicalizeName(nico)).toBe(nico);
      expect(canonicalizeName(inaki)).toBe(inaki);
      // Sin la regla de apellido único, dos jugadores con el mismo apellido
      // podrían fusionarse; aquí demostramos que isSameLastNameReference
      // requiere UN solo jugador con ese apellido en el equipo.
      const rosterCon2Williams = ["Nico Williams", "Iñaki Williams"];
      expect(isSameLastNameReference("Williams", "Nico Williams", rosterCon2Williams)).toBe(false);
      expect(isSameLastNameReference("Williams", "Iñaki Williams", rosterCon2Williams)).toBe(false);
    });
  });

  describe("Persistencia contra BD (escenario exacto del screenshot)", () => {
    it("4 fuentes, 1 con nombre completo + 3 con apellido solo → 1 único player_id", async () => {
      // Limpia cualquier ejecución previa del propio equipo de test.
      await pool.query("DELETE FROM latest_player_forecast WHERE player_id IN (SELECT id FROM players WHERE team_id IN (SELECT id FROM teams WHERE slug = $1))", [TEST_TEAM_SLUG]);

      // Una sola fuente: FutbolFantasy publica el nombre completo.
      // Las otras 3 (Comuniate, AnalíticaFantasy, JornadaPerfecta) publican
      // solo el apellido. El matcher DEBE colapsarlas todas en un único
      // player_id (el que ya esté en el roster).
      const sources = await pool.query<{ id: string; slug: string }>(
        `SELECT id::text, slug FROM sources WHERE slug = ANY($1)`,
        [TEST_SOURCE_SLUGS],
      );
      const bySlug = new Map(sources.rows.map((r) => [r.slug, r.id]));

      // Caso 1: roster tiene "Ademola Lookman" completo. Las 3 fuentes
      // publican solo "Lookman". Deben matchear con el completo.
      await pool.query(
        `INSERT INTO players (id, team_id, name, position) VALUES (gen_random_uuid(), (SELECT id FROM teams WHERE slug=$1), 'Ademola Lookman', 'DEL')`,
        [TEST_TEAM_SLUG],
      );

      const playerIdFutbolFantasy = await pool.query<{ id: string }>(
        `SELECT id::text FROM players WHERE team_id = (SELECT id FROM teams WHERE slug=$1) AND name = 'Ademola Lookman' LIMIT 1`,
        [TEST_TEAM_SLUG],
      );
      const existingId = playerIdFutbolFantasy.rows[0].id;

      // 3 scrapes con solo "Lookman" desde cada fuente.
      for (const slug of ["test-comuniate", "test-analiticafantasy", "test-jornadaperfecta"]) {
        const result: ScraperResult = {
          sourceId: bySlug.get(slug)!,
          fetchedAt: new Date(),
          teams: [{
            teamSlug: TEST_TEAM_SLUG,
            players: [{ playerName: "Lookman", probabilityPct: 70 }],
            events: [],
          }],
        };
        await persistScraperResult(result, bySlug.get(slug)!, logger, pool);
      }

      // 1 scrape con el nombre completo desde FutbolFantasy.
      const fullResult: ScraperResult = {
        sourceId: bySlug.get("test-futbolfantasy")!,
        fetchedAt: new Date(),
        teams: [{
          teamSlug: TEST_TEAM_SLUG,
          players: [{ playerName: "Ademola Lookman", probabilityPct: 90 }],
          events: [],
        }],
      };
      await persistScraperResult(fullResult, bySlug.get("test-futbolfantasy")!, logger, pool);

      // Verificación: debe haber UN SOLO player_id con forecasts para ese equipo.
      const playerIds = await pool.query<{ pid: string; n: number }>(
        `SELECT f.player_id::text AS pid, COUNT(*)::int AS n
         FROM latest_player_forecast f
         JOIN players p ON p.id = f.player_id
         JOIN teams t ON t.id = p.team_id
         WHERE t.slug = $1 AND p.name LIKE '%Lookman%'
         GROUP BY f.player_id`,
        [TEST_TEAM_SLUG],
      );

      expect(playerIds.rows.length).toBe(1);
      expect(playerIds.rows[0].pid).toBe(existingId);
      expect(playerIds.rows[0].n).toBe(4); // 4 fuentes, 4 forecasts en el mismo player_id

      // Y el nombre en la BD debe seguir siendo "Ademola Lookman" (no se renombra).
      const nombre = await pool.query<{ name: string }>(
        `SELECT name FROM players WHERE id = $1::uuid`,
        [existingId],
      );
      expect(nombre.rows[0].name).toBe("Ademola Lookman");
    });
  });
});
