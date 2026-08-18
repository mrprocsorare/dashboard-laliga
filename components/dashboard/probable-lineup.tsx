import type { PlayerWithConsensus } from "@/lib/data";

export function ProbableLineup({
  players,
  emptyLabel = "Sin XI disponible.",
}: {
  players: PlayerWithConsensus[];
  emptyLabel?: string;
}) {
  if (!players.length) {
    return <p className="py-3 text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
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
  );
}
