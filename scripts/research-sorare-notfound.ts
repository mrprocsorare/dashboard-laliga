import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SorareApiClient } from "../lib/sorare-client";
import type { SorareCandidate } from "@/lib/sorare-matching";

const CSV_PATH = process.argv[2] ?? "data/sorare/not_found_sorare_2026-08-25T07-53-26-760Z.csv";

const HEADERS = [
  "player_id", "nombre_actual", "canonical_name", "equipo", "posicion",
  "fecha_nacimiento", "nacionalidad", "variantes_slug", "legacy_sorare_slug",
  "external_player_id", "external_slug", "motivo",
  "sorare_player_id", "sorare_slug", "confidence", "verification_status",
  "verification_source", "notes",
] as const;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function normalizeCompare(s: string): string {
  let t = stripAccents(s.toLowerCase());
  t = t.replace(/\bjr\.?\b/g, "junior").replace(/\bsr\.?\b/g, "senior");
  t = t.replace(/\b\d+([a-záéíóúñ]*)\b/g, "");
  t = t.replace(/[^a-z0-9]+/g, " ");
  return t.replace(/\s+/g, " ").trim();
}
function tokens(s: string): string[] {
  return normalizeCompare(s).split(/\s+/).filter(Boolean);
}
function dice(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sb = new Set(tb);
  let inter = 0;
  for (const x of new Set(ta)) if (sb.has(x)) inter++;
  return (2 * inter) / (ta.length + tb.length);
}
const TEAM_NOISE = new Set(["cf", "ud", "rc", "cd", "fc", "ca", "ac", "ad", "club", "de", "la", "el", "il", "al", "sd"]);
function normTeam(s: string): string {
  return stripAccents(s.toLowerCase()).split(/\s+/).filter((t) => t && !TEAM_NOISE.has(t)).join(" ").trim();
}
function clubMatch(a: string, b: string): boolean {
  const na = normTeam(a), nb = normTeam(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
function normNat(s: string | null): string {
  if (!s) return "";
  return stripAccents(s.toUpperCase()).replace(/[^A-Z]/g, "");
}
function normDob(s: string | null): string {
  if (!s) return "";
  return s.replace(/\D/g, "");
}

interface Row {
  player_id: string; nombre_actual: string; canonical_name: string; equipo: string;
  posicion: string; fecha_nacimiento: string; nacionalidad: string;
  variantes_slug: string; legacy_sorare_slug: string; motivo: string;
}
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
function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  const idx = (n: string) => header.indexOf(n);
  const i = Object.fromEntries(HEADERS.map((h) => [h, idx(h)])) as Record<string, number>;
  const out: Row[] = [];
  for (let n = 1; n < lines.length; n++) {
    const c = parseLine(lines[n]);
    out.push({
      player_id: c[i.player_id] ?? "", nombre_actual: c[i.nombre_actual] ?? "",
      canonical_name: c[i.canonical_name] ?? "", equipo: c[i.equipo] ?? "",
      posicion: c[i.posicion] ?? "", fecha_nacimiento: c[i.fecha_nacimiento] ?? "",
      nacionalidad: c[i.nacionalidad] ?? "", variantes_slug: c[i.variantes_slug] ?? "",
      legacy_sorare_slug: c[i.legacy_sorare_slug] ?? "", motivo: c[i.motivo] ?? "",
    });
  }
  return out;
}
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Scored { c: SorareCandidate; nameSim: number; clubMatch: boolean; dobMatch: boolean; natMatch: boolean; combined: number; }
function score(row: Row, c: SorareCandidate): Scored {
  const rowName = row.canonical_name || row.nombre_actual;
  const nameSim = Math.max(
    dice(rowName, c.displayName ?? ""),
    dice(rowName, `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()),
  );
  const cm = !!c.activeClubName && clubMatch(row.equipo, c.activeClubName);
  const dm = normDob(row.fecha_nacimiento) !== "" && normDob(row.fecha_nacimiento) === normDob(c.birthDay ?? "");
  const nm = normNat(row.nacionalidad) !== "" && normNat(row.nacionalidad) === normNat(c.nationality ?? "");
  const combined = nameSim + (dm ? 0.3 : 0) + (cm ? 0.15 : 0) + (nm ? 0.1 : 0);
  return { c, nameSim, clubMatch: cm, dobMatch: dm, natMatch: nm, combined };
}
function classify(row: Row, cands: SorareCandidate[]): { kind: "verified" | "ambiguous" | "weak"; best?: Scored } {
  const scored = cands.map((c) => score(row, c));
  const plausible = scored.filter((s) =>
    (s.dobMatch && s.nameSim >= 0.5) || (s.clubMatch && s.nameSim >= 0.7) || s.nameSim >= 0.9,
  );
  if (plausible.length === 0) return { kind: "weak" };
  plausible.sort((a, b) => b.combined - a.combined);
  const top = plausible[0];
  if (plausible.length > 1 && plausible[1].combined >= top.combined - 0.1) return { kind: "ambiguous", best: top };
  if (top.dobMatch && top.nameSim >= 0.5) return { kind: "verified", best: top };
  if (top.clubMatch && top.nameSim >= 0.7) return { kind: "verified", best: top };
  if (top.nameSim >= 0.9) return { kind: "verified", best: top };
  return { kind: "ambiguous", best: top };
}

async function main() {
  const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const client = new SorareApiClient({ budget: 400, requestsPerMinute: 12, minIntervalMs: 5200 });

  const primary = rows.map((r) => r.canonical_name || r.nombre_actual);
  const primaryRes = await client.searchPlayers(primary, 1);

  const secondaryNeeded: string[] = [];
  const merged = new Map<string, SorareCandidate[]>();
  rows.forEach((r) => {
    const cands = dedupe(primaryRes.get((r.canonical_name || r.nombre_actual).trim()) ?? []);
    merged.set(r.player_id, cands);
    const res = classify(r, cands);
    if (res.kind === "weak") {
      const w = tokens(r.canonical_name || r.nombre_actual);
      if (w.length) secondaryNeeded.push(w[0]);
    }
  });
  if (secondaryNeeded.length) {
    const secRes = await client.searchPlayers(secondaryNeeded, 1);
    rows.forEach((r) => {
      const w = tokens(r.canonical_name || r.nombre_actual);
      if (!w.length) return;
      const extra = dedupe(secRes.get(w[0].trim()) ?? []);
      const map = new Map(merged.get(r.player_id)!.map((c) => [c.slug, c]));
      for (const c of extra) if (c.slug) map.set(c.slug, c);
      merged.set(r.player_id, [...map.values()]);
    });
  }

  const outDir = join(process.cwd(), "data", "sorare");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const resolvedLines: string[] = [HEADERS.join(",")];
  const ambiguous: unknown[] = [];
  let verified = 0, ambiguousCount = 0, weak = 0;

  for (const r of rows) {
    const cands = merged.get(r.player_id) ?? [];
    const res = classify(r, cands);
    const filled = [
      r.player_id, r.nombre_actual, r.canonical_name, r.equipo, r.posicion,
      r.fecha_nacimiento, r.nacionalidad, r.variantes_slug, r.legacy_sorare_slug, "", "", r.motivo,
      "", "", "", "", "", "",
    ];
    if (res.kind === "verified" && res.best && res.best.c.id && res.best.c.slug) {
      const c = res.best.c;
      const conf = Math.min(0.99, 0.7 + (res.best.dobMatch ? 0.2 : 0) + (res.best.clubMatch ? 0.05 : 0) + (res.best.natMatch ? 0.04 : 0));
      filled[12] = c.id ?? ""; filled[13] = c.slug ?? ""; filled[14] = conf.toFixed(2);
      filled[15] = "verified"; filled[16] = "sorare_api";
      filled[17] = `${res.best.dobMatch ? "dob✓" : "dob✗"}; club=${c.activeClubName}; ns=${res.best.nameSim.toFixed(2)}; ${res.best.natMatch ? "nat✓" : ""}`;
      verified++;
    } else if (res.kind === "ambiguous" || res.kind === "weak") {
      ambiguous.push({
        player_id: r.player_id, name: r.nombre_actual, equipo: r.equipo,
        reason: res.kind, best: res.best ? mini(res.best.c) : null, candidates: cands.map(mini),
      });
      if (res.kind === "ambiguous") ambiguousCount++; else weak++;
    }
    resolvedLines.push(filled.map(csvEscape).join(","));
  }

  const resolvedPath = join(outDir, `not_found_sorare_resolved_${stamp}.csv`);
  const ambigPath = join(outDir, `research_ambiguous_${stamp}.json`);
  writeFileSync(resolvedPath, resolvedLines.join("\n") + "\n", "utf8");
  writeFileSync(ambigPath, JSON.stringify(ambiguous, null, 2), "utf8");
  console.log(`Total: ${rows.length}`);
  console.log(`Verified: ${verified}`);
  console.log(`Ambiguous: ${ambiguousCount}  Weak: ${weak}`);
  console.log(`Resolved CSV: ${resolvedPath}`);
  console.log(`Ambiguous JSON: ${ambigPath}`);
}
function dedupe(c: SorareCandidate[]): SorareCandidate[] {
  const m = new Map<string, SorareCandidate>();
  for (const x of c) if (x.slug) m.set(x.slug, x);
  return [...m.values()];
}
function mini(c: SorareCandidate) {
  return { slug: c.slug, id: c.id ?? null, displayName: c.displayName ?? null, club: c.activeClubName ?? null, nationality: c.nationality ?? null, birthDay: c.birthDay ?? null };
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
