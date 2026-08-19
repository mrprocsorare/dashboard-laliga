import { PlayerAvatar } from "@/components/dashboard/player-avatar";
import { cn } from "@/lib/utils";
import type { XIPlayer } from "@/lib/data";
import { SorareMeta } from "@/components/dashboard/sorare-meta";
import { SorarePlayerDialog } from "@/components/dashboard/sorare-player-dialog";

/**
 * Campo de fútbol con el once de consenso.
 * Disposición vertical (atacando hacia arriba): DEL arriba, MED, DEF, POR abajo.
 * Cada jugador se coloca según `formationPosition` (asignada por selectXI).
 * Paleta verde oscura, limpia y sobria.
 */

interface PitchRow {
  label: string;
  players: XIPlayer[];
}

export function Pitch({ xi }: { xi: XIPlayer[] }) {
  if (xi.length === 0) return null;

  const rows: PitchRow[] = [
    { label: "DEL", players: xi.filter((p) => p.formationPosition === "DEL") },
    { label: "MED", players: xi.filter((p) => p.formationPosition === "MED") },
    { label: "DEF", players: xi.filter((p) => p.formationPosition === "DEF") },
    { label: "POR", players: xi.filter((p) => p.formationPosition === "POR") },
  ].filter((r) => r.players.length > 0);

  return (
    <div className="mx-auto aspect-[3/4] w-full max-w-sm select-none overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-800 to-emerald-950 ring-1 ring-emerald-700/40 sm:max-w-md">
      <div className="relative h-full">
        {/* franjas de césped */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0%, transparent 12%, white 12%, white 13%, transparent 13%, transparent 25%)",
          }}
        />
        {/* línea de medio campo */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
        {/* círculo central */}
        <div className="absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 sm:size-20" />
        {/* áreas */}
        <div className="absolute left-1/2 top-0 h-[16%] w-3/5 -translate-x-1/2 border-x border-b border-white/20" />
        <div className="absolute bottom-0 left-1/2 h-[16%] w-3/5 -translate-x-1/2 border-x border-t border-white/20" />

        <div className="relative flex h-full flex-col justify-around gap-1 px-2 py-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-around">
              {row.players.map((p) => (
                <PlayerNode key={p.id} player={p} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerNode({ player }: { player: XIPlayer }) {
  const pct = player.consensus!.probability_pct;
  const ringColor =
    pct >= 80
      ? "ring-green-400"
      : pct >= 60
        ? "ring-amber-400"
        : "ring-red-400";

  return (
    <div className="flex max-w-[72px] flex-col items-center gap-0.5 sm:max-w-[88px]">
      <SorarePlayerDialog player={player}>
        <span className="block rounded-lg px-1 py-0.5 transition-colors hover:bg-black/20">
          <span className="relative block">
            <PlayerAvatar
              name={player.name}
              photoUrl={player.photo_url}
              className={cn(
                "size-9 ring-2 ring-offset-1 ring-offset-emerald-900 sm:size-12 sm:ring-offset-2",
                ringColor,
              )}
            />
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-black/80 px-1 text-[9px] font-bold text-white tabular-nums sm:text-[10px]">
              {pct}%
            </span>
          </span>
          <span className="block w-full truncate text-center text-[10px] font-medium text-white/90 sm:text-xs">
            {player.name}
          </span>
          {player.sorare ? <SorareMeta data={player.sorare} compact tone="light" /> : null}
        </span>
      </SorarePlayerDialog>
    </div>
  );
}
