import Link from "next/link";
import { ProbableLineup } from "@/components/dashboard/probable-lineup";
import { TeamCrest } from "@/components/dashboard/team-crest";
import type { XIPlayer } from "@/lib/data";

export function MatchXI({
  teamName,
  teamSlug,
  logoUrl,
  players,
}: {
  teamName: string;
  teamSlug: string | null;
  logoUrl?: string | null;
  players: XIPlayer[];
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TeamCrest slug={teamSlug} name={teamName} logoUrl={logoUrl} className="size-7 rounded-md p-0.5" />
          <h3 className="truncate text-sm font-semibold">{teamName}</h3>
        </div>
        {teamSlug ? (
          <Link href={`/team/${teamSlug}`} className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline">
            Ver equipo
          </Link>
        ) : null}
      </div>
      <ProbableLineup players={players} />
    </div>
  );
}
