import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { SorareApiClient, SORARE_PLAYER_QUERY, toSorarePlayerResponse } from "../lib/sorare-client";

interface BulkMapping {
  player_id: string;
  sorare_player_id?: string | null;
  sorare_slug?: string | null;
  confidence?: number;
  verification_source?: string;
  notes?: string;
  [key: string]: unknown;
}

const csvPath = "data/sorare/not_found_sorare_2026-08-25T07-53-26-760Z.csv";
const mapPath = "data/sorare/verified_mappings.json";

const GUESS: Record<string, string[]> = {
  "inigo-ruiz-de-galarreta": ["625bb085-ca29-4c37-b521-ad8057b5c6f0"],
  "aleix-febas": ["6a7715e7-9eef-4ded-9443-163c3e0e25df"],
  "javi-galan": ["60b5a8d2-7eaa-4d61-9aab-b7a0dd7de91f"],
  "ander-guevara": ["12d8e70f-e081-4dc6-a138-2f58d46d2647"],
  "carlos-benavidez": ["126ca8f5-05e7-4404-a5d1-2a0438767b6b"],
  "jesus-owono": ["a33ddd8e-ae4d-4e7e-8441-41169257f0fe"],
  "jonny": ["fe05644d-c06c-423b-9f53-7abe54a9ced5"],
  "lander-pinillos": ["d0d687e5-63ed-476a-9a41-3243724bb48d"],
  "protesoni": ["b8cccccd-f123-4294-9748-5c2ea455bbdb"],
  "youssef-enriquez": ["210e6713-b021-4394-9500-269e6bcbbed8"],
  "german-parreno": ["c8453287-2b63-40d0-b14d-a80c38f7274b"],
  "jose-angel-jurado": ["05dbfd4a-e79e-45ec-97b9-02ef25546f79"],
  "noe-carrillo": ["08b128cf-58db-4584-8356-09a688e89280"],
  "riki-rodriguez": ["61412d05-5b8b-43e4-a135-b195d511379e"],
  "pedro-bigas": ["ef496035-d232-4a74-ac7f-b20523d6e481"],
  "javi-morcillo": ["dc2e5581-fdce-4302-aa65-f7de9d879e6c"],
  "jose-antonio-morente": ["6edbac5a-348a-414c-ab10-6cb977b81d6a"],
  "owen-bosch": ["16842807-d1d2-4922-997d-4bc82cb1e05d"],
  "albert-niculaesei": ["013c81a3-c1cb-458a-af43-48174ff77c93"],
  "fermin-lopez-marin": ["69954e10-6417-40a0-917c-803918868be7"],
  "pedri": ["01c7dcb1-a659-4105-a064-925c31b0150b"],
  "abdel-abqar": ["ca487670-a5da-4ee7-aac5-00e1d203c27d"],
  "johan-mojica": ["0629b2cb-b9d4-4950-91e1-430ae5c3fb76"],
  "juanmi": ["482015dc-71c7-41f2-8176-7ac49b14f4fc"],
  "adrian-de-la-fuente": ["563f187e-e29f-4ac5-8a9f-3650c82d32ec"],
  "alejandro-primo": ["90e3fc54-2fe7-4e61-abaa-aba2e4a38ca1"],
  "dani-requena": ["14939835-8269-40cc-8a7b-64043fa22f29", "cd91d887-0709-4e0a-a007-bc22702149fa"],
  "etta-eyong": ["78e4f4e9-d0e8-40f5-98ce-5a01e962fcbb"],
  "ivan-romero": ["a201028f-f6f6-40e1-8957-d951ee72e382"],
  "jon-ander-olasagasti": ["b76290ee-272e-450a-8b24-3e55ebe9b3fd"],
  "roger-brugue": ["d4932652-c975-4031-a092-6e0ae5867c54"],
  "eneko-jauregi": ["82b85620-a674-4d36-ac1d-ad0823d9f747"],
  "juanpe": ["fcc4e153-fb99-4043-83b8-15ee19e48b07"],
  "rafita-garrido": ["d9a6d7f4-fead-4d2e-a274-50a36f503fd8"],
  "manu-hernando": ["6dc11d01-d4bd-4b40-9abe-0ec3305ce54f"],
  "sergio-canales": ["0dc10885-6269-483a-979c-9878c9b633f9"],
  "alexandre-zurawski": ["105f1b70-78da-4d3d-a5be-d43498ec2bb8"],
  "dani-cardenas": ["46d1a1fd-c8a4-4961-abb8-43f972b94858"],
  "kike-garcia": ["8ed3b33d-0602-466e-bc93-8c0f854e7406"],
  "abde-ezzalzouli": ["b67cdb77-3f1a-463b-a664-6995917384b5"],
  "hector-bellerin": ["c5410bac-f463-4ff9-aef5-4fdbbe2783f1"],
  "jose-antonio-morante": ["50f07b7a-1bb1-41a1-b077-e81e1af69a34"],
  "brahim-diaz": ["e5dcd794-959d-41c4-b88d-74275bd82e3a"],
  "aihen-munoz": ["c013362f-85cd-4259-9bf4-c7222f7c9d92"],
  "alvaro-odriozola": ["c86642a9-e93b-4c59-8bd9-8d1d15c621d4"],
  "benat-turrientes": ["66cb3568-b89c-444e-9686-60d9fb333a6e"],
  "igor-zubeldia": ["0b0f93e7-6a46-4fc1-8d5c-a08b1f262448"],
  "mikel-oyarzabal-ugarte": ["93e0a63b-e9c8-4669-9ef8-49939ce14510"],
  "take-kubo": ["007102f5-1a2d-43f5-a78a-271814a25395"],
  "alfonso-gonzalez": ["880bc2e5-1dad-409e-b65c-311e7872b4e1"],
  "nico-guillen": ["deb857fc-1ee9-49f6-ad2c-4243fe69ac1b"],
  "odysseas-vlachodimos": ["86913131-6efc-4784-9bbe-bbb059c20d4e", "4f9e55f3-8b6c-4a62-8bec-9e2dfed3c298"],
  "jose-luis-garcia-vaya": ["3899b42d-deb2-41f1-982f-0a3c08ecb545"],
  "luis-rioja": ["39ba5510-d662-462e-86a6-5e77b97ad87b"],
  "ruben-iranzo": ["b233b955-644a-4735-8438-4f02967db107"],
  "umar-sadiq": ["6563b89a-6b74-4bf2-b326-16377caff8f9"],
};

function parseCsv(path: string) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  const idx = (n: string) => header.indexOf(n);
  return rows.map((r) => ({
    player_id: r[idx("player_id")],
    nombre: r[idx("nombre_actual")],
    equipo: r[idx("equipo")],
  }));
}

async function main() {
  const client = new SorareApiClient({ budget: 60, requestsPerMinute: 12, minIntervalMs: 5200 });
  const csv = parseCsv(csvPath);
  const clubByPid = new Map(csv.map((r) => [r.player_id, r.equipo]));
  const nameByPid = new Map(csv.map((r) => [r.player_id, r.nombre]));

  const existing: BulkMapping[] = JSON.parse(readFileSync(mapPath, "utf8"));
  const resolved = new Set(existing.map((m) => m.player_id));

  const slugs = Object.keys(GUESS);
  const chunks: string[][] = [];
  for (let i = 0; i < slugs.length; i += 25) chunks.push(slugs.slice(i, i + 25));

  const added: BulkMapping[] = [];
  const reviewed = new Set<string>();
  for (const chunk of chunks) {
    const data = await client.request<{ players: Array<Parameters<typeof toSorarePlayerResponse>[0]> }>(
      SORARE_PLAYER_QUERY,
      { slugs: chunk },
    );
    const players = (data.players ?? []).filter(Boolean).map((p) => toSorarePlayerResponse(p));
    for (const p of players) {
      const pids = GUESS[p.slug] ?? [];
      const expected = (pids.map((id: string) => clubByPid.get(id)).filter(Boolean)) as string[];
      const matchPid = pids.find((id: string) => clubByPid.get(id) === p.activeClubName && !resolved.has(id));
      if (matchPid) {
        added.push({
          player_id: matchPid,
          sorare_player_id: p.id,
          sorare_slug: p.slug,
          confidence: 0.9,
          verification_source: "sorare_api",
          notes: `club=${p.activeClubName}; dob=${p.birthDay ?? "?"}; name=${nameByPid.get(matchPid)}`,
        });
        resolved.add(matchPid);
        reviewed.add(p.slug);
        console.log(`OK  ${p.slug} -> ${nameByPid.get(matchPid)} (${p.activeClubName})`);
      } else {
        console.log(`MIS ${p.slug} club=${p.activeClubName} expected=${expected.join("|")}`);
        reviewed.add(p.slug);
      }
    }
  }
  const unmatched = slugs.filter((s) => !reviewed.has(s));
  for (const s of unmatched) console.log(`NUL ${s}`);

  if (added.length) {
    const next = [...existing, ...added];
    writeFileSync(mapPath, JSON.stringify(next, null, 2) + "\n");
    console.log(`\nAdded ${added.length} mappings (total ${next.length}).`);
  } else {
    console.log("\nNo new matches.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
