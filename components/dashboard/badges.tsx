import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS, RUN_STATUS_LABELS } from "@/lib/format";
import type { EventType, Position, RunStatus, Severity } from "@/lib/data";

/**
 * Badges semánticos del dashboard. Componentes de servidor (sin estado).
 * Regla de colores del consenso: verde ≥80, ámbar 60-79, rojo <60.
 */

const GREEN =
  "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400";
const AMBER =
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400";
const RED =
  "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400";
const BLUE =
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-400";
const GRAY =
  "border-border bg-muted text-muted-foreground";

export function probabilityTone(pct: number): string {
  if (pct >= 80) return GREEN;
  if (pct >= 60) return AMBER;
  return RED;
}

/** Probabilidad de consenso con el código de color acordado. */
export function ProbabilityBadge({ pct }: { pct: number }) {
  return (
    <Badge variant="outline" className={cn("tabular-nums", probabilityTone(pct))}>
      {pct}%
    </Badge>
  );
}

const POSITION_TONES: Record<Position, string> = {
  POR: AMBER,
  DEF: BLUE,
  MED: GREEN,
  DEL: RED,
};

/** Posición del jugador (POR/DEF/MED/DEL). */
export function PositionBadge({ position }: { position: Position | null }) {
  if (!position) {
    return (
      <Badge variant="outline" className={GRAY}>
        —
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={POSITION_TONES[position]}>
      {position}
    </Badge>
  );
}

const EVENT_TYPE_TONES: Record<EventType, string> = {
  injury: RED,
  suspension: AMBER,
  doubt: BLUE,
  transfer: GREEN,
};

/** Tipo de evento: Lesión, Sanción, Duda, Fichaje. */
export function EventTypeBadge({ type }: { type: EventType }) {
  return (
    <Badge variant="outline" className={EVENT_TYPE_TONES[type]}>
      {EVENT_TYPE_LABELS[type] ?? type}
    </Badge>
  );
}

/** Texto coloreado de severidad (sin badge, para no recargar la lista). */
export function SeverityLabel({ severity }: { severity: Severity }) {
  if (severity === "none") return null;
  const tone =
    severity === "light"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  const label =
    severity === "light"
      ? "Leve"
      : severity === "moderate"
        ? "Moderada"
        : severity === "serious"
          ? "Grave"
          : "Baja segura";
  return <span className={cn("text-xs font-medium", tone)}>{label}</span>;
}

const RUN_STATUS_TONES: Record<RunStatus, string> = {
  success: GREEN,
  partial: AMBER,
  failed: RED,
  running: BLUE,
};

/** Estado de la última ejecución de una fuente. */
export function RunStatusBadge({ status }: { status: RunStatus | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className={GRAY}>
        Sin ejecuciones
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={RUN_STATUS_TONES[status]}>
      {RUN_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
