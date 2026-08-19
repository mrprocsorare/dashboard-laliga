"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { MatchPrediction } from "@/components/dashboard/match-prediction";
import { MatchXI } from "@/components/dashboard/match-xi";
import { TeamCrest } from "@/components/dashboard/team-crest";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JornadaMatch } from "@/lib/data";
import { matchAnchorId } from "@/lib/match-anchor";

function matchDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function JornadaView({ matches }: { matches: JornadaMatch[] }) {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("match");
  const [selectedId, setSelectedId] = useState(
    () => matches.find((match) => match.odds.external_event_id === requestedId)?.odds.external_event_id
      ?? matches[0]?.odds.external_event_id
      ?? "",
  );
  const selected = matches.find((match) => match.odds.external_event_id === selectedId) ?? matches[0];
  const rounds = [...new Set(matches.map((match) => match.odds.matchday))];

  if (!selected) return null;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-3 sm:p-4">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selector de partidos</p>
            <p className="mt-1 text-sm text-muted-foreground">Elige un partido para consultar sus alineaciones y pronóstico.</p>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{matches.length} partidos</span>
        </div>
        <div className="space-y-3">
          {rounds.map((round) => {
            const roundMatches = matches.filter((match) => match.odds.matchday === round);
            return (
              <div key={round ?? "sin-jornada"} className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {round ? `Jornada ${round}` : "Jornada pendiente"}
                </p>
                <div className="flex snap-x gap-2 overflow-x-auto pb-1">
                  {roundMatches.map((match) => {
                    const active = match.odds.external_event_id === selected.odds.external_event_id;
                    return (
                      <button
                        key={match.odds.external_event_id}
                        type="button"
                        onClick={() => setSelectedId(match.odds.external_event_id)}
                        className={`min-w-44 snap-start rounded-lg border px-3 py-2 text-left transition-colors sm:min-w-52 ${
                          active ? "border-primary bg-primary/10" : "bg-background/50 hover:bg-muted"
                        }`}
                      >
                        <span className="block text-[11px] text-muted-foreground">{shortDate(match.odds.commence_time)}</span>
                        <span className="mt-1 block truncate text-xs font-semibold">
                          <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
                            <TeamCrest slug={match.homeTeam?.slug ?? null} name={match.odds.home_team_name} logoUrl={match.homeTeam?.logo_url} className="size-5 rounded p-0.5" />
                            <span className="truncate">{match.odds.home_team_name}</span>
                            <span className="font-normal text-muted-foreground">vs</span>
                            <TeamCrest slug={match.awayTeam?.slug ?? null} name={match.odds.away_team_name} logoUrl={match.awayTeam?.logo_url} className="size-5 rounded p-0.5" />
                            <span className="truncate">{match.odds.away_team_name}</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div id={matchAnchorId(selected.odds.external_event_id)}>
        <MatchCard match={selected} />
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: JornadaMatch }) {
  const oddsAvailable =
    match.odds.probability_home_pct !== null &&
    match.odds.probability_draw_pct !== null &&
    match.odds.probability_away_pct !== null;

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Partido seleccionado</p>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>{match.odds.home_team_name} <span className="text-muted-foreground">vs</span> {match.odds.away_team_name}</span>
          <span className="text-xs font-normal text-muted-foreground">{matchDate(match.odds.commence_time)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="rounded-lg border bg-muted/20 p-3" aria-label="Pronóstico del partido">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pronóstico 1X2</h2>
            {oddsAvailable ? <span className="text-[11px] text-muted-foreground">Probabilidad implícita</span> : null}
          </div>
          {oddsAvailable ? (
            <MatchPrediction
              home={match.odds.probability_home_pct}
              draw={match.odds.probability_draw_pct}
              away={match.odds.probability_away_pct}
              homeLabel={match.odds.home_team_name}
              awayLabel={match.odds.away_team_name}
              bookmaker={match.odds.bookmaker}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Cuotas no disponibles para este partido.</p>
          )}
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          <MatchXI
            teamName={match.homeTeam?.name ?? match.odds.home_team_name}
            teamSlug={match.homeTeam?.slug ?? null}
            logoUrl={match.homeTeam?.logo_url}
            players={match.homeXI}
          />
          <MatchXI
            teamName={match.awayTeam?.name ?? match.odds.away_team_name}
            teamSlug={match.awayTeam?.slug ?? null}
            logoUrl={match.awayTeam?.logo_url}
            players={match.awayXI}
          />
        </div>
      </CardContent>
    </Card>
  );
}
