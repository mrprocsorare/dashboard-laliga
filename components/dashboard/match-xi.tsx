import Link from "next/link";
import type { XIPlayer } from "@/lib/data";

export function MatchXI({
  teamName,
  teamSlug,
  players,
}: {
  teamName: string;
  teamSlug: string | null;
  players: XIPlayer[];
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{teamName}</h3>
        {teamSlug ? (
          <Link href={`/team/${teamSlug}`} className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline">
            Ver equipo
          </Link>
        ) : null}
      </div>
      {players.length ? (
        <ol className="space-y-1.5">
          {players.map((player) => (
            <li key={player.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-7 shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
                  {player.position ?? "—"}
                </span>
                <span className="truncate">{player.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {player.consensus?.probability_pct ?? "—"}%
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-3 text-xs text-muted-foreground">Sin XI disponible.</p>
      )}
    </div>
  );
}
