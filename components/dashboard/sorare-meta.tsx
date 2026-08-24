import type { SorarePlayerData } from "@/lib/sorare";

function score(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

function price(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value / 100);
}

export function SorareMeta({
  data,
  compact = false,
  fallback = "Sin datos Sorare",
  tone = "muted",
}: {
  data: SorarePlayerData | null;
  compact?: boolean;
  fallback?: string;
  tone?: "muted" | "light";
}) {
  if (!data) return <span className="text-[10px] text-muted-foreground">{fallback}</span>;

  return (
    <span
      className={
        compact
          ? `inline-flex max-w-full flex-wrap justify-center gap-x-1 text-[10px] tabular-nums ${tone === "light" ? "text-white/75" : "text-muted-foreground"}`
          : "flex flex-wrap gap-x-2 gap-y-0.5 text-xs tabular-nums text-muted-foreground"
      }
      title="Datos persistidos de Sorare · Limited Classic e In-Season"
    >
      <span>SO5 {score(data.averageScore)}</span>
      {!compact && data.latestScore !== null ? <span>últ. {score(data.latestScore)}</span> : null}
      {!compact ? <span>Classic {price(data.classic.eurCents)}</span> : null}
      {!compact ? <span>In-Season {price(data.inSeason.eurCents)}</span> : null}
    </span>
  );
}
