import "dotenv/config";
import { Pool } from "pg";
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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });

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

  const totalClusters: Array<{
    teamSlug: string;
    players: { id: string; name: string }[];
  }> = [];

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
      totalClusters.push({
        teamSlug,
        players: members.map((m) => ({ id: m.id, name: m.rawName })),
      });
    }
  }

  console.log(`Total clusters con duplicados: ${totalClusters.length}\n`);
  for (const cluster of totalClusters) {
    const ids = cluster.players.map((p) => p.id);
    console.log(`=== Equipo: ${cluster.teamSlug} ===`);
    for (const p of cluster.players) {
      console.log(`  - id=${p.id}  name="${p.name}"`);
    }
    const fc = await pool.query(
      `SELECT player_id::text AS pid, source_id::text AS sid, COUNT(*)::int AS n
       FROM latest_player_forecast WHERE player_id = ANY($1::uuid[])
       GROUP BY player_id, source_id ORDER BY pid, sid`,
      [ids],
    );
    const ec = await pool.query(
      `SELECT player_id::text AS pid, COUNT(*)::int AS n
       FROM player_events WHERE player_id = ANY($1::uuid[]) GROUP BY player_id`,
      [ids],
    );
    const cc = await pool.query(
      `SELECT player_id::text AS pid, COUNT(*)::int AS n
       FROM player_consensus WHERE player_id = ANY($1::uuid[]) GROUP BY player_id`,
      [ids],
    );
    const sp = await pool.query(
      `SELECT team_id::text FROM latest_set_pieces WHERE team_id IN (
         SELECT team_id FROM players WHERE id = ANY($1::uuid[])
       )`,
      [ids],
    );
    console.log(`  forecasts (player_id, source_id, n):`, JSON.stringify(fc.rows));
    console.log(`  events por player_id:`, JSON.stringify(ec.rows));
    console.log(`  consensus por player_id:`, JSON.stringify(cc.rows));
    console.log(`  latest_set_pieces afectados (team_id):`, JSON.stringify(sp.rows));
    console.log("");
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
