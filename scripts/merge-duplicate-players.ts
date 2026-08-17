import "dotenv/config";
import { Pool, PoolClient } from "pg";
import {
  aliasVariantsFor,
  canonicalizeName,
  normalizeName,
  significantTokens,
} from "../services/player-names";

type PlayerRow = { id: string; team_id: string; team_slug: string; name: string };

class UnionFind {
  private parent = new Map<string, string>();
  add(id: string) { if (!this.parent.has(id)) this.parent.set(id, id); }
  find(id: string): string {
    let cur = id;
    while (this.parent.get(cur) !== cur) {
      const p = this.parent.get(cur)!;
      const pp = this.parent.get(p)!;
      this.parent.set(cur, pp);
      cur = pp;
    }
    return cur;
  }
  union(a: string, b: string) {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  clusters(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const id of this.parent.keys()) {
      const r = this.find(id);
      const set = out.get(r) ?? new Set<string>();
      set.add(id); out.set(r, set);
    }
    return out;
  }
}

const isSameLastNameReference = (
  shortName: string, longName: string, rosterNames: string[],
): boolean => {
  if (!shortName || !longName) return false;
  const shortTokens = significantTokens(shortName);
  const longTokens = significantTokens(longName);
  if (shortTokens.length !== 1 || longTokens.length < 2) return false;
  const short = shortTokens[0];
  const first = longTokens[0];
  const last = longTokens[longTokens.length - 1];
  if (short !== first && short !== last) return false;
  const sameCount = rosterNames.filter((n) => significantTokens(n).includes(short)).length;
  return sameCount <= 1;
};

const sameByCanonicalAlias = (
  a: { canon: string; rawName: string },
  b: { canon: string; rawName: string },
): boolean => {
  const canonA = normalizeName(a.canon);
  const canonB = normalizeName(b.canon);
  if (canonA && canonB && canonA === canonB) return true;
  const va = aliasVariantsFor(a.canon);
  if (va.has(normalizeName(b.rawName))) return true;
  const vb = aliasVariantsFor(b.canon);
  if (vb.has(normalizeName(a.rawName))) return true;
  return false;
};

const sameByNormalizedEquality = (a: { rawName: string }, b: { rawName: string }) => {
  const na = normalizeName(a.rawName); const nb = normalizeName(b.rawName);
  return Boolean(na) && na === nb;
};

interface Plan {
  teamSlug: string;
  leader: { id: string; name: string; forecastCount: number };
  followers: { id: string; name: string; forecastCount: number }[];
}

async function computePlan(pool: Pool): Promise<Plan[]> {
  const playersRes = await pool.query<PlayerRow>(`
    SELECT p.id::text AS id, p.team_id::text AS team_id, t.slug AS team_slug, p.name
    FROM players p JOIN teams t ON t.id = p.team_id
    ORDER BY t.slug, p.name
  `);
  const players = playersRes.rows;

  const byTeam = new Map<string, PlayerRow[]>();
  for (const p of players) {
    const arr = byTeam.get(p.team_slug) ?? [];
    arr.push(p);
    byTeam.set(p.team_slug, arr);
  }

  const allIds = players.map((p) => p.id);
  const fcRes = await pool.query<{ player_id: string; n: number }>(
    `SELECT player_id::text AS player_id, COUNT(*)::int AS n
     FROM latest_player_forecast WHERE player_id = ANY($1::uuid[]) GROUP BY player_id`,
    [allIds],
  );
  const forecastCount = new Map<string, number>();
  for (const r of fcRes.rows) forecastCount.set(r.player_id, r.n);

  const plan: Plan[] = [];

  for (const [teamSlug, items] of byTeam) {
    const decorated = items.map((p) => ({
      id: p.id, rawName: p.name, canon: canonicalizeName(p.name),
    }));
    const uf = new UnionFind();
    for (const d of decorated) uf.add(d.id);

    const rosterNames = decorated.map((d) => d.rawName);
    for (let i = 0; i < decorated.length; i++) {
      for (let j = i + 1; j < decorated.length; j++) {
        const a = decorated[i]; const b = decorated[j];
        if (uf.find(a.id) === uf.find(b.id)) continue;
        let same = false;
        if (sameByCanonicalAlias(a, b)) same = true;
        else if (sameByNormalizedEquality(a, b)) same = true;
        else if (isSameLastNameReference(a.rawName, b.rawName, rosterNames)) same = true;
        else if (isSameLastNameReference(b.rawName, a.rawName, rosterNames)) same = true;
        if (same) uf.union(a.id, b.id);
      }
    }

    for (const cluster of uf.clusters().values()) {
      if (cluster.size < 2) continue;
      const members = [...cluster].map((id) => decorated.find((d) => d.id === id)!);
      // Líder: el que tenga más forecasts; empate: el nombre más completo.
      const ranked = [...members].sort((a, b) => {
        const fa = forecastCount.get(a.id) ?? 0;
        const fb = forecastCount.get(b.id) ?? 0;
        if (fa !== fb) return fb - fa;
        const ta = significantTokens(a.rawName).length;
        const tb = significantTokens(b.rawName).length;
        if (ta !== tb) return tb - ta;
        return normalizeName(b.rawName).length - normalizeName(a.rawName).length;
      });
      const leader = ranked[0];
      const followers = ranked.slice(1);
      plan.push({
        teamSlug,
        leader: { id: leader.id, name: leader.rawName, forecastCount: forecastCount.get(leader.id) ?? 0 },
        followers: followers.map((f) => ({
          id: f.id, name: f.rawName, forecastCount: forecastCount.get(f.id) ?? 0,
        })),
      });
    }
  }
  return plan;
}

async function applyMerge(pool: Pool, plan: Plan[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of plan) {
      await applyOne(client, p);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function applyOne(client: PoolClient, p: Plan): Promise<void> {
  const leaderId = p.leader.id;
  const followerIds = p.followers.map((f) => f.id);

  // 1) latest_player_forecast: mover cada (player_id, source_id) del follower
  //    al líder. Si ya existe en el líder, gana el de fetched_at más reciente.
  for (const fid of followerIds) {
    const rows = await client.query<{
      id_dummy: number; source_id: string; probability_pct: number;
      is_certain: boolean; forecast_type: string; note: string | null; fetched_at: Date;
    }>(
      `SELECT source_id::text, probability_pct, is_certain, forecast_type, note, fetched_at
       FROM latest_player_forecast WHERE player_id = $1::uuid`,
      [fid],
    );
    for (const r of rows.rows) {
      const existing = await client.query(
        `SELECT 1 FROM latest_player_forecast
         WHERE player_id = $1::uuid AND source_id = $2::uuid`,
        [leaderId, r.source_id],
      );
      if (existing.rowCount === 0) {
        await client.query(
          `UPDATE latest_player_forecast SET player_id = $1::uuid
           WHERE player_id = $2::uuid AND source_id = $3::uuid`,
          [leaderId, fid, r.source_id],
        );
      } else {
        const leaderRow = await client.query<{ fetched_at: Date }>(
          `SELECT fetched_at FROM latest_player_forecast
           WHERE player_id = $1::uuid AND source_id = $2::uuid`,
          [leaderId, r.source_id],
        );
        const leaderNewer = leaderRow.rows[0].fetched_at >= r.fetched_at;
        if (leaderNewer) {
          await client.query(
            `DELETE FROM latest_player_forecast
             WHERE player_id = $1::uuid AND source_id = $2::uuid`,
            [fid, r.source_id],
          );
        } else {
          await client.query(
            `UPDATE latest_player_forecast
             SET probability_pct = $3, is_certain = $4, forecast_type = $5, note = $6, fetched_at = $7
             WHERE player_id = $1::uuid AND source_id = $2::uuid`,
            [leaderId, r.source_id, r.probability_pct, r.is_certain, r.forecast_type, r.note, r.fetched_at],
          );
          await client.query(
            `DELETE FROM latest_player_forecast
             WHERE player_id = $1::uuid AND source_id = $2::uuid`,
            [fid, r.source_id],
          );
        }
      }
    }
  }

  // 2) player_events: append-only, mover todos al líder.
  await client.query(
    `UPDATE player_events SET player_id = $1::uuid WHERE player_id = ANY($2::uuid[])`,
    [leaderId, followerIds],
  );

  // 3) player_consensus: si el follower tiene fila y el líder no, moverla.
  //    Si el líder ya tiene, descartar la del follower.
  for (const fid of followerIds) {
    const exists = await client.query(
      `SELECT 1 FROM player_consensus WHERE player_id = $1::uuid`,
      [fid],
    );
    if (!exists.rowCount) continue;
    const leaderHas = await client.query(
      `SELECT 1 FROM player_consensus WHERE player_id = $1::uuid`,
      [leaderId],
    );
    if (!leaderHas.rowCount) {
      await client.query(
        `UPDATE player_consensus SET player_id = $1::uuid WHERE player_id = $2::uuid`,
        [leaderId, fid],
      );
    } else {
      await client.query(
        `DELETE FROM player_consensus WHERE player_id = $1::uuid`,
        [fid],
      );
    }
  }

  // 4) Borrar los followers de players.
  await client.query(
    `DELETE FROM players WHERE id = ANY($1::uuid[])`,
    [followerIds],
  );
}

function printPlan(plan: Plan[]): void {
  if (!plan.length) {
    console.log("[dry-run] No hay clusters duplicados. Nada que fusionar.");
    return;
  }
  console.log(`[dry-run] Plan de fusión: ${plan.length} cluster(s).\n`);
  for (const p of plan) {
    console.log(`Equipo: ${p.teamSlug}`);
    console.log(`  LÍDER    -> id=${p.leader.id}  name="${p.leader.name}"  forecasts=${p.leader.forecastCount}`);
    for (const f of p.followers) {
      console.log(`  FOLLOWER -> id=${f.id}  name="${f.name}"  forecasts=${f.forecastCount}`);
    }
    console.log("");
  }
  console.log(`Total filas a fusionar: ${plan.reduce((acc, p) => acc + p.followers.length, 0)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });

  const plan = await computePlan(pool);
  if (!apply) {
    printPlan(plan);
    console.log("\n(dry-run) Para aplicar de verdad, ejecuta: npx tsx scripts/merge-duplicate-players.ts --apply");
    await pool.end();
    return;
  }

  console.log(`[apply] Ejecutando fusión de ${plan.length} cluster(s)...`);
  printPlan(plan);
  await applyMerge(pool, plan);
  console.log("[apply] Fusión completada.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
