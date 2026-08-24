import { normalizeName } from "../services/player-names";

export interface SlugVariantSource {
  name: string;
  canonicalName?: string | null;
}

function searchName(row: SlugVariantSource): string {
  const canonical = (row.canonicalName ?? "")
    .replace(/\{\{.*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return canonical || row.name.trim();
}

export function slugVariants(row: SlugVariantSource): string[] {
  const raw = searchName(row)
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\{\{.*/g, " ")
    .replace(/\b\d+(?:er|nd|rd|th|o|a)?\b/g, " ")
    .replace(/\b(jr|junior|ii|iii|iv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeName(raw).trim();
  if (!normalized) return [];

  const isInitial = (token: string) => /^[a-z]\.?$/.test(token);
  const isParticle = (token: string) =>
    ["de", "da", "do", "del", "das", "dos"].includes(token);

  const allParts = normalized.split(" ").filter(Boolean);
  const significant = allParts.filter((part) => part.length > 1 || isInitial(part));
  if (!significant.length) return [];

  const first = significant[0];
  const last = significant.at(-1);
  const values = new Set<string>();

  const push = (slug: string) => {
    const clean = slug.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (clean.length >= 3) values.add(clean);
  };

  push(significant.join("-"));
  if (significant.length >= 2) push(`${first}-${last}`);
  if (significant.length >= 3) push(significant.slice(0, 2).join("-"));
  if (significant.length >= 3) push(significant.slice(-2).join("-"));
  if (first.length >= 3) push(first);
  if (last && last.length >= 3 && last !== first) push(last);

  const noParticles = significant.filter((part) => !isParticle(part));
  if (noParticles.length >= 2) {
    push(`${noParticles[0]}-${noParticles.at(-1)}`);
    if (noParticles.length >= 3) push(noParticles.slice(0, 2).join("-"));
  }

  if (isInitial(first) && significant.length >= 2) {
    push(`${first.replace(".", "")}-${last}`);
  }
  if (isInitial(first) && significant.length >= 3) {
    push(significant.slice(1).join("-"));
  }

  return [...values];
}
