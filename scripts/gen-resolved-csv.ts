import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2] ?? "data/sorare/not_found_sorare_2026-08-25T07-53-26-760Z.csv";
const MAP = process.argv[3] ?? "data/sorare/verified_mappings.json";
const OUT = process.argv[4] ?? "data/sorare/not_found_sorare_resolved.csv";

const HEADERS = [
  "player_id", "nombre_actual", "canonical_name", "equipo", "posicion",
  "fecha_nacimiento", "nacionalidad", "variantes_slug", "legacy_sorare_slug",
  "external_player_id", "external_slug", "motivo",
  "sorare_player_id", "sorare_slug", "confidence", "verification_status",
  "verification_source", "notes",
];

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out.map((s) => s.trim());
}
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const mappings = JSON.parse(readFileSync(MAP, "utf8")) as Array<{
  player_id: string; sorare_player_id: string; sorare_slug: string;
  confidence: number; verification_source: string; notes: string;
}>;
const byId = new Map(mappings.map((m) => [m.player_id, m]));

const text = readFileSync(SRC, "utf8");
const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
const out: string[] = [HEADERS.join(",")];
let filled = 0;
for (let n = 1; n < lines.length; n++) {
  const cells = parseLine(lines[n]);
  const pid = cells[0];
  const m = byId.get(pid);
  if (m) {
    cells[12] = m.sorare_player_id;
    cells[13] = m.sorare_slug;
    cells[14] = String(m.confidence);
    cells[15] = "verified";
    cells[16] = m.verification_source;
    cells[17] = m.notes;
    filled++;
  }
  out.push(cells.map(csvEscape).join(","));
}
writeFileSync(join(process.cwd(), OUT), out.join("\n") + "\n", "utf8");
console.log(`Mappings aplicados: ${filled} / ${mappings.length} del mapa.`);
console.log(`CSV generado: ${OUT}`);
