import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { NextUpdateCountdown } from "@/components/dashboard/countdown";
import { TeamCrest } from "@/components/dashboard/team-crest";
import { getHomeData, type RunStatus } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<RunStatus, string> = {
  success: "bg-green-500",
  partial: "bg-amber-500",
  failed: "bg-red-500",
  running: "bg-sky-500",
};

export default async function HomePage() {
  const { teams, sources } = await getHomeData();
  const totalConsensus = teams.reduce((s, t) => s + t.playersWithConsensus, 0);

  return (
    <DashboardShell>
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Fuentes ({sources.length})
          </h2>
          <NextUpdateCountdown />
        </div>
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  s.lastRunStatus ? STATUS_DOT[s.lastRunStatus] : "bg-muted-foreground/30",
                )}
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">
                {s.lastRunAt ? timeAgo(s.lastRunAt) : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Equipos ({teams.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            {totalConsensus} jugadores con consenso
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {teams.map((t) => {
            const hasData = t.playersWithConsensus > 0;
            return (
              <Link
                key={t.id}
                href={`/team/${t.slug}`}
                className="group rounded-xl border p-3 transition-all hover:border-foreground/20 hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TeamCrest slug={t.slug} name={t.name} logoUrl={t.logo_url} className="size-8 rounded-md" />
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold leading-tight">
                        {t.name}
                      </h3>
                      <p className="text-xs text-muted-foreground">{t.short_name}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 size-2 shrink-0 rounded-full",
                      hasData ? "bg-green-500" : "bg-muted-foreground/20",
                    )}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasData
                    ? `${t.playersWithConsensus} previsiones · ${t.likelyStarters} probables`
                    : "Sin datos todavía"}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </DashboardShell>
  );
}
