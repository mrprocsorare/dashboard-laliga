"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Cuenta atrás hasta la próxima ejecución automática del CI de scraping.
 *
 * GitHub Actions corre con cron cada 15 minutos (minutos 0, 15, 30 y 45).
 * Calculamos el siguiente cuarto de hora a partir de la hora local del
 * navegador y mostramos el tiempo restante, actualizando cada segundo.
 * SSR-safe: hasta que el efecto se ejecuta en el cliente mostramos un
 * placeholder estático.
 */
export function NextUpdateCountdown({ className }: { className?: string }) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setMs(msUntilNextQuarter());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  if (ms === null) {
    return (
      <div className={cn("text-xs text-muted-foreground", className)}>
        Actualización automática cada 15 min
      </div>
    );
  }

  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  let label: string;
  if (totalSec < 60) {
    label = `en ${totalSec}s`;
  } else if (min < 10) {
    label = `en ${min}:${String(sec).padStart(2, "0")}`;
  } else {
    label = `en ${min} min`;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      title="Próxima ejecución automática del pipeline de scraping (cron */15)"
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          totalSec < 60
            ? "bg-amber-500 animate-pulse"
            : "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      <span>Próxima actualización {label}</span>
    </div>
  );
}

function msUntilNextQuarter(): number {
  const now = new Date();
  const m = now.getMinutes();
  const nextQuarter = Math.floor(m / 15) * 15 + 15;
  const next = new Date(now);
  next.setMinutes(nextQuarter, 0, 0);
  return next.getTime() - now.getTime();
}