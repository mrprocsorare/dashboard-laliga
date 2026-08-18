import { cn } from "@/lib/utils";

export function MatchPrediction({
  home,
  draw,
  away,
  homeLabel,
  awayLabel,
  bookmaker,
}: {
  home: number | null;
  draw: number | null;
  away: number | null;
  homeLabel: string;
  awayLabel: string;
  bookmaker: string | null;
}) {
  const items = [
    { key: "home", label: "Victoria local", value: home, detail: homeLabel, tone: "text-emerald-500" },
    { key: "draw", label: "Empate", value: draw, detail: "X", tone: "text-amber-500" },
    { key: "away", label: "Victoria visitante", value: away, detail: awayLabel, tone: "text-sky-500" },
  ];

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const available = item.value !== null;
          return (
            <div key={item.key} className="rounded-lg border bg-background/50 px-2 py-3 text-center sm:px-3">
              <p className={cn("text-[10px] font-semibold uppercase tracking-wide", available ? item.tone : "text-muted-foreground/50")}>
                {item.label}
              </p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums sm:text-3xl", available ? "text-foreground" : "text-muted-foreground/50")}>
                {available ? `${item.value}%` : "—"}
              </p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.detail}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-right text-[11px] text-muted-foreground">
        Cuotas 1X2 · {bookmaker ?? "Fuente de cuotas"}
      </p>
    </div>
  );
}
