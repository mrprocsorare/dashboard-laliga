"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { TeamCrest } from "@/components/dashboard/team-crest";
import type { TeamNavInfo } from "@/lib/data";

/** Navegador entre equipos: |‹ anterior| [ select ] |siguiente ›| */
export function TeamNav({
  teams,
  currentSlug,
}: {
  teams: TeamNavInfo[];
  currentSlug: string;
}) {
  const router = useRouter();
  const idx = teams.findIndex((t) => t.slug === currentSlug);
  const prev = idx > 0 ? teams[idx - 1] : null;
  const next = idx < teams.length - 1 ? teams[idx + 1] : null;

  return (
    <nav className="flex items-center justify-between gap-2">
      {prev ? (
        <Link
          href={`/team/${prev.slug}`}
          className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft />
          <TeamCrest slug={prev.slug} name={prev.name} logoUrl={prev.logo_url} className="size-5 rounded p-0" />
          <span className="hidden max-w-[72px] truncate sm:inline">
            {prev.short_name}
          </span>
        </Link>
      ) : (
        <span className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground/30">
          <ChevronLeft />
        </span>
      )}

      <select
        value={currentSlug}
        onChange={(e) => router.push(`/team/${e.target.value}`)}
        className="max-w-[60%] flex-1 truncate rounded-lg border bg-background px-3 py-1.5 text-center text-sm font-medium outline-none focus:ring-2 focus:ring-ring/40"
        aria-label="Cambiar de equipo"
      >
        {teams.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name}
          </option>
        ))}
      </select>

      {next ? (
        <Link
          href={`/team/${next.slug}`}
          className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="hidden max-w-[72px] truncate sm:inline">
            {next.short_name}
          </span>
          <TeamCrest slug={next.slug} name={next.name} logoUrl={next.logo_url} className="size-5 rounded p-0" />
          <ChevronRight />
        </Link>
      ) : (
        <span className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground/30">
          <ChevronRight />
        </span>
      )}
    </nav>
  );
}

function ChevronLeft() {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
