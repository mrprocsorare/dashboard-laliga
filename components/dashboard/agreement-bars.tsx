import { cn } from "@/lib/utils";
import type { AgreementEntry } from "@/lib/data";
import { formatDateTime } from "@/lib/format";

/**
 * Visualización compacta del consenso entre fuentes: una mini-barra por
 * fuente, coloreada según su probabilidad. Las barras a 0% (fuente que cubre
 * al jugador pero no lo considera titular) se muestran vacías/dimmed; las
 * fuentes con probabilidad alta se rellenan en verde. Así, de un vistazo se ve
 * qué fuentes coinciden y cuáles discrepan.
 */
export function AgreementBars({
  agreement,
  sourceMap,
}: {
  agreement: AgreementEntry[];
  sourceMap: Map<string, { name: string; baseUrl: string }>;
}) {
  // Orden estable por nombre de fuente para que la barra de cada equipo sea
  // comparable visualmente (misma posición = misma fuente).
  const items = [...agreement].sort((a, b) => {
    const an = sourceMap.get(a.source)?.name ?? a.source;
    const bn = sourceMap.get(b.source)?.name ?? b.source;
    return an.localeCompare(bn, "es");
  });

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((a) => {
        const src = sourceMap.get(a.source);
        const label = src?.name ?? a.source;
        const pct = a.probability;
        const confirmed = a.forecast_type === "confirmed";
        const tone =
          confirmed
            ? "bg-indigo-600"
            : pct >= 80
            ? "bg-emerald-500"
            : pct >= 60
              ? "bg-amber-500"
              : pct > 0
                ? "bg-red-500"
                : "bg-muted";
        const dim = pct === 0 && !confirmed;
        const href = src?.baseUrl;

        const inner = (
          <span className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-block size-2 shrink-0 rounded-sm",
                dim ? "ring-1 ring-border bg-muted" : tone,
              )}
              aria-hidden
            />
            <span className={cn("w-20 shrink-0 truncate", dim ? "text-muted-foreground/60" : "text-muted-foreground")}>
              {label}
            </span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-full", dim ? "bg-muted-foreground/20" : tone)}
                style={{ width: `${Math.max(pct, dim ? 0 : 3)}%` }}
              />
            </span>
            <span
              className={cn(
                "w-10 shrink-0 text-right tabular-nums",
                dim ? "text-muted-foreground/60" : "font-medium text-foreground",
              )}
            >
              {pct > 0 ? `${pct}%` : "—"}
            </span>
            {confirmed ? (
              <span className="shrink-0 rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                Confirmada
              </span>
            ) : null}
          </span>
        );

        return href ? (
          <a
            key={a.source}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`${label} (${pct}%, ${confirmed ? "alineación confirmada" : "estimación probable"}, actualizado ${formatDateTime(a.fetched_at)})`}
            className="block rounded px-1 -mx-1 transition-colors hover:bg-muted"
          >
            {inner}
          </a>
        ) : (
          <span
            key={a.source}
            title={`${a.source} (${pct}%, actualizado ${formatDateTime(a.fetched_at)})`}
            className="block px-1 -mx-1"
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}
