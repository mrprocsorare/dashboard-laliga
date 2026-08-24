"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, X } from "lucide-react";
import type { PlayerWithConsensus } from "@/lib/data";

function score(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

function price(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value / 100);
}

export function SorarePlayerDialog({
  player,
  children,
}: {
  player: PlayerWithConsensus;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const data = player.sorare;

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!data) return children;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block min-w-0 max-w-full cursor-pointer rounded-md text-left outline-none ring-offset-background transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Ver datos de Sorare de ${player.name}`}
      >
        {children}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`sorare-dialog-title-${player.id}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[min(88vh,42rem)] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                   Datos persistidos de Sorare · Limited
                </p>
                <h2 id={`sorare-dialog-title-${player.id}`} className="mt-1 text-xl font-semibold tracking-tight">
                  {player.name}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                   SO5 actualizado {data.scoresUpdatedAt ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.scoresUpdatedAt)) : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Cerrar datos de Sorare"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
               <Metric label="Media SO5" value={score(data.averageScore)} accent />
               <Metric label="Última" value={score(data.latestScore)} />
               <Metric label="Classic" value={price(data.classic.eurCents)} />
               <Metric label="In-Season" value={price(data.inSeason.eurCents)} />
               <Metric label="Prob. titular" value={player.consensus ? `${player.consensus.probability_pct}%` : "-"} />
            </div>

            <section className="mt-5 rounded-xl border bg-muted/25 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Últimas puntuaciones SO5</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Rendimiento reciente disponible en Sorare.</p>
                </div>
                <span className="text-xs text-muted-foreground">{data.scores.length} registros</span>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={`score-${index}`} className="rounded-lg border bg-background px-2 py-2 text-center">
                    <span className="block text-lg font-semibold tabular-nums">{score(data.scores[index] ?? null)}</span>
                    <span className="text-[10px] text-muted-foreground">J-{index + 1}</span>
                  </div>
                ))}
              </div>
              {!data.scores.length ? <p className="mt-3 text-xs text-muted-foreground">No hay puntuaciones recientes.</p> : null}
            </section>

            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href={`https://sorare.com/football/players/${data.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Ver perfil en Sorare
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
              {data.classic.cardSlug ? (
                <a
                  href={`https://sorare.com/football/cards/${data.classic.cardSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted"
                >
                   Ver carta Classic
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
              {data.inSeason.cardSlug ? (
                <a
                  href={`https://sorare.com/football/cards/${data.inSeason.cardSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted"
                >
                  Ver carta In-Season
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border bg-muted/25 px-3 py-3">
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`mt-1 block text-lg font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</span>
    </div>
  );
}
