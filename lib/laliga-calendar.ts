const SEASON_RANGES: Array<{ season: string; start: string; end: string }> = [
  { season: "2025-26", start: "2025-08-15", end: "2026-05-24" },
  { season: "2026-27", start: "2026-08-14", end: "2027-05-23" },
];

function startOfWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

export function inferRealJornada(date: Date): number | null {
  const t = date.getTime();
  for (const r of SEASON_RANGES) {
    const s = Date.parse(r.start + "T00:00:00Z");
    const e = Date.parse(r.end + "T23:59:59Z");
    if (t < s || t > e) continue;
    const seasonStart = startOfWeek(new Date(s));
    const dWeek = startOfWeek(date);
    const diffMs = dWeek.getTime() - seasonStart.getTime();
    const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    const jornada = week + 1;
    if (jornada < 1) return 1;
    if (jornada > 38) return 38;
    return jornada;
  }
  return null;
}
