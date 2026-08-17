import { cn } from "@/lib/utils";

export function MatchProbabilityBars({
  home,
  draw,
  away,
  homeLabel,
  awayLabel,
}: {
  home: number | null;
  draw: number | null;
  away: number | null;
  homeLabel: string;
  awayLabel: string;
}) {
  const items = [
    { key: "home", label: homeLabel, value: home, tone: "bg-emerald-500" },
    { key: "draw", label: "Empate", value: draw, tone: "bg-amber-500" },
    { key: "away", label: awayLabel, value: away, tone: "bg-indigo-500" },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const available = item.value !== null;
        const value = item.value ?? 0;
        return (
          <div key={item.key} className="flex items-center gap-2 text-xs">
            <span className={cn("w-28 shrink-0 truncate", available ? "text-muted-foreground" : "text-muted-foreground/50")}>
              {item.label}
            </span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-full", available ? item.tone : "bg-muted-foreground/20")}
                style={{ width: `${available ? value : 0}%` }}
              />
            </span>
            <span className={cn("w-10 text-right tabular-nums", available ? "font-medium" : "text-muted-foreground/50")}>
              {available ? `${value}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
