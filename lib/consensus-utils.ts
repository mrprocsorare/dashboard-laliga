import type { ConsensusInfo } from "@/lib/data";

/**
 * Un jugador está "excluido por mayoría" cuando más fuentes que cubren su
 * equipo NO lo ven titular (no lo listan o lo dan en 0%) y ninguna fuente lo
 * marca como confirmado. En ese caso el consenso se fuerza a 0% por posible
 * baja, lesión o traspaso. Se deriva del `agreement` para no necesitar una
 * columna extra en BD (espejo de la regla en services/consensus.ts).
 *
 * Módulo aparte de `lib/data.ts` a propósito: `lib/data.ts` importa el cliente
 * de Supabase de servidor (next/headers) y no debe entrar en el bundle de los
 * Client Components. Aquí solo se importa el tipo (se borra al compilar).
 */
export function isExcludedByMajority(consensus: ConsensusInfo | null): boolean {
  if (!consensus) return false;
  let starterSources = 0;
  let nonStarterSources = 0;
  let hasConfirmedStarter = false;
  for (const a of consensus.agreement) {
    if (a.probability > 0) starterSources += 1;
    else nonStarterSources += 1;
    if (a.forecast_type === "confirmed" && a.probability > 0) hasConfirmedStarter = true;
  }
  return nonStarterSources > starterSources && !hasConfirmedStarter;
}
