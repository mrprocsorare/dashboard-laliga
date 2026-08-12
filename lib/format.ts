/**
 * Helpers de formato para el dashboard (etiquetas en español y tiempos
 * relativos). Puro: usable desde Server y Client Components.
 */

/** "hace un momento", "hace 5 min", "hace 3 h", "hace 2 d" o fecha corta. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "hace un momento";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}

/** Fecha + hora corta para tooltips/detalle: "12 ago, 14:35". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  injury: "Lesión",
  suspension: "Sanción",
  doubt: "Duda",
  transfer: "Fichaje",
};

export const SEVERITY_LABELS: Record<string, string> = {
  none: "Sin gravedad",
  light: "Leve",
  moderate: "Moderada",
  serious: "Grave",
  out: "Baja segura",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: "En curso",
  success: "OK",
  partial: "Parcial",
  failed: "Fallo",
};
