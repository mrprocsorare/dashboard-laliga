import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { MatchProbabilityBars } from "@/components/dashboard/match-probability-bars";
import { MatchXI } from "@/components/dashboard/match-xi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getJornadaData } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function matchDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function JornadaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getJornadaData();
  const current = data.matches.filter((m) => m.odds.matchday === data.currentMatchday);
  const next = data.matches.filter((m) => m.odds.matchday === data.nextMatchday);

  return (
    <DashboardShell email={user.email}>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Calendario</p>
        <h1 className="text-3xl font-semibold tracking-tight">Partidos de la jornada</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cuotas 1X2 reales de mercado y el XI más probable de cada equipo según el consenso.
        </p>
      </div>

      {!data.matches.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Todavía no hay partidos de LaLiga disponibles.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <MatchdaySection label={data.currentMatchday ? `Jornada ${data.currentMatchday}` : "Jornada actual"} matches={current} />
          {next.length ? (
            <MatchdaySection label={data.nextMatchday ? `Próxima jornada · ${data.nextMatchday}` : "Próxima jornada"} matches={next} />
          ) : null}
        </div>
      )}
    </DashboardShell>
  );
}

function MatchdaySection({
  label,
  matches,
}: {
  label: string;
  matches: Awaited<ReturnType<typeof getJornadaData>>["matches"];
}) {
  if (!matches.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h2>
      <div className="grid gap-4">
        {matches.map((match) => {
          const oddsAvailable =
            match.odds.probability_home_pct !== null &&
            match.odds.probability_draw_pct !== null &&
            match.odds.probability_away_pct !== null;
          return (
            <Card key={match.odds.external_event_id}>
              <CardHeader className="gap-1 pb-3">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>{match.odds.home_team_name} <span className="text-muted-foreground">vs</span> {match.odds.away_team_name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{matchDate(match.odds.commence_time)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {oddsAvailable ? (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span>Probabilidad de mercado</span>
                      <span>{match.odds.bookmaker ?? "Fuente de cuotas"}</span>
                    </div>
                    <MatchProbabilityBars
                      home={match.odds.probability_home_pct}
                      draw={match.odds.probability_draw_pct}
                      away={match.odds.probability_away_pct}
                      homeLabel={match.odds.home_team_name}
                      awayLabel={match.odds.away_team_name}
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    Cuotas no disponibles para este partido. El XI y el partido siguen disponibles.
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <MatchXI
                    teamName={match.homeTeam?.name ?? match.odds.home_team_name}
                    teamSlug={match.homeTeam?.slug ?? null}
                    players={match.homeXI}
                  />
                  <MatchXI
                    teamName={match.awayTeam?.name ?? match.odds.away_team_name}
                    teamSlug={match.awayTeam?.slug ?? null}
                    players={match.awayXI}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
