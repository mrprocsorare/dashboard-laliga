import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/dashboard/app-header";
import { RunStatusBadge } from "@/components/dashboard/badges";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getHomeData } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { teams, sources } = await getHomeData();
  const failedSources = sources.filter((s) => s.lastRunStatus === "failed");

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 p-6">
      <AppHeader email={user.email} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Fuentes ({sources.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Actualización automática cada 15 min
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((s) => (
            <Card key={s.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {s.name}
                  {!s.enabled ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      desactivada
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  {s.lastRunAt
                    ? `Última ejecución ${timeAgo(s.lastRunAt)}`
                    : "Aún no se ha ejecutado"}
                  {s.lastRunStatus === "failed" && s.lastRunError
                    ? ` · ${s.lastRunError}`
                    : ""}
                </CardDescription>
                <CardAction>
                  <RunStatusBadge status={s.lastRunStatus} />
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
        {failedSources.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Si una fuente falla, el dashboard conserva y muestra su último dato
            válido.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Equipos de LaLiga ({teams.length})
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.map((t) => (
            <Link key={t.id} href={`/team/${t.slug}`} className="block">
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription>
                    {t.playersWithConsensus > 0
                      ? `${t.playersWithConsensus} jugadores con previsión · ${t.likelyStarters} probables`
                      : "Sin datos de consenso todavía"}
                  </CardDescription>
                  <CardAction>
                    {t.playersWithConsensus > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
                      >
                        Consenso
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-border bg-muted text-muted-foreground"
                      >
                        Sin datos
                      </Badge>
                    )}
                  </CardAction>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
