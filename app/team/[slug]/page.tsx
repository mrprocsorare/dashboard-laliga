import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { AgreementBars } from "@/components/dashboard/agreement-bars";
import {
  EventTypeBadge,
  PositionBadge,
  ProbabilityBadge,
  SeverityLabel,
} from "@/components/dashboard/badges";
import { PlayerAvatar } from "@/components/dashboard/player-avatar";
import { Pitch } from "@/components/dashboard/pitch";
import { ProbableLineup } from "@/components/dashboard/probable-lineup";
import { TeamCrest } from "@/components/dashboard/team-crest";
import { TeamNav } from "@/components/dashboard/team-nav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deriveFormation,
  getAllTeamsForNav,
  getSourceMap,
  getTeamData,
  selectXI,
  type PlayerWithConsensus,
  type Severity,
  type TeamEvent,
  type MatchOddsRow,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEVERITY_RANK: Record<Severity, number> = {
  out: 4,
  serious: 3,
  moderate: 2,
  light: 1,
  none: 0,
};

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [data, allTeams, sourceMap] = await Promise.all([
    getTeamData(slug),
    getAllTeamsForNav(),
    getSourceMap(),
  ]);
  if (!data) notFound();

  const { team, players, events, teamConsensus, upcomingMatches } = data;
  const withConsensus = players.filter((p) => p.consensus);
  const xi = selectXI(players);
  const formation = xi.length > 0 ? deriveFormation(xi) : null;
  const sortedEvents = [...events].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.recordedAt.localeCompare(a.recordedAt),
  );

  return (
    <DashboardShell>
      <div className="space-y-4">
        <TeamNav teams={allTeams} currentSlug={slug} />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <TeamCrest slug={team.slug} name={team.name} logoUrl={team.logo_url} />
            <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
          </div>
          {formation ? (
            <span className="rounded-md border bg-muted px-2 py-0.5 text-sm font-medium tabular-nums">
              {formation}
            </span>
          ) : null}
          {teamConsensus?.coach ? (
            <span className="text-sm text-muted-foreground">
              {teamConsensus.coach}
            </span>
          ) : null}
        </div>

        {withConsensus.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Once actualizado {timeAgo(withConsensus[0].consensus!.updated_at)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Todavía no hay previsiones de ninguna fuente para este equipo.
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Once más probable ({xi.length})
        </h2>
        {xi.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr] lg:items-start">
            <Pitch xi={xi} />
            <Card>
              <CardHeader>
                <CardTitle>Alineación probable</CardTitle>
                <CardDescription>Posición, jugador y probabilidad de titularidad.</CardDescription>
              </CardHeader>
              <CardContent>
                <ProbableLineup players={xi} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Sin datos suficientes para mostrar el once.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Plantilla y consenso ({players.length})
          </h2>
          <span className="text-xs text-muted-foreground">{withConsensus.length} con previsión</span>
        </div>
        <Card>
          <CardContent>
            <PlayersTable players={players} sourceMap={sourceMap} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Próximos partidos</h2>
        {upcomingMatches.length ? (
          <Card>
            <CardContent className="divide-y">
              {upcomingMatches.map((match) => <UpcomingMatch key={match.external_event_id} match={match} />)}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">No hay próximos partidos disponibles.</CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Lesiones y sanciones ({sortedEvents.length})
        </h2>
        {sortedEvents.length > 0 ? (
          <Card>
            <CardContent className="divide-y">
              {sortedEvents.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Sin eventos recientes (ventana de 48 h).
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Balón parado
        </h2>
        <SetPiecesCard teamConsensus={teamConsensus} />
      </section>
    </DashboardShell>
  );
}

function PlayersTable({
  players,
  sourceMap,
}: {
  players: PlayerWithConsensus[];
  sourceMap: Map<string, { name: string; baseUrl: string }>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Jugador</TableHead>
          <TableHead>Pos</TableHead>
          <TableHead>Consenso</TableHead>
          <TableHead>Fuentes</TableHead>
          <TableHead className="w-full">Acuerdo entre fuentes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.map((p) => {
          const c = p.consensus;
          return (
            <TableRow key={p.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <PlayerAvatar name={p.name} photoUrl={p.photo_url} />
                  <span className="whitespace-normal font-medium">{p.name}</span>
                </span>
              </TableCell>
              <TableCell>
                <PositionBadge position={p.position} />
              </TableCell>
              <TableCell>{c ? <ProbabilityBadge pct={c.probability_pct} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
              <TableCell>
                <span
                  className="text-xs tabular-nums text-muted-foreground"
                  title={c ? `${c.sources_starter} de ${c.sources_total} fuentes lo consideran titular` : "Sin previsión"}
                >
                  {c ? `${c.sources_starter}/${c.sources_total}` : "—"}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <AgreementBars
                  agreement={c?.agreement ?? []}
                  sourceMap={sourceMap}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function UpcomingMatch({ match }: { match: MatchOddsRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-medium">
          {match.home_team_name} <span className="font-normal text-muted-foreground">vs</span> {match.away_team_name}
        </p>
        <p className="text-xs text-muted-foreground">{formatMatchDate(match.commence_time)}</p>
      </div>
      {match.bookmaker ? <span className="text-xs text-muted-foreground">Cuotas: {match.bookmaker}</span> : null}
    </div>
  );
}

function formatMatchDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function EventRow({ event }: { event: TeamEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
      <EventTypeBadge type={event.eventType} />
      <SeverityLabel severity={event.severity} />
      <span className="font-medium">{event.playerName}</span>
      {event.reason ? (
        <span className="text-sm text-muted-foreground">{event.reason}</span>
      ) : null}
      {event.expectedReturn ? (
        <span className="text-xs text-muted-foreground">
          · vuelta: {event.expectedReturn}
        </span>
      ) : null}
      <span className="ml-auto text-xs text-muted-foreground">
        {event.sourceName} · {timeAgo(event.recordedAt)}
      </span>
    </div>
  );
}

function SetPiecesCard({
  teamConsensus,
}: {
  teamConsensus: {
    set_pieces: { penalty: string[]; corner: string[]; free_kick: string[] } | null;
  } | null;
}) {
  const pieces = teamConsensus?.set_pieces;
  const groups: { title: string; takers: string[] }[] = [
    { title: "Penaltis", takers: pieces?.penalty ?? [] },
    { title: "Córners", takers: pieces?.corner ?? [] },
    { title: "Faltas", takers: pieces?.free_kick ?? [] },
  ];
  const hasAny = groups.some((g) => g.takers.length > 0);

  if (!hasAny) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Sin datos de lanzadores todavía.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader>
            <CardTitle>{g.title}</CardTitle>
            <CardDescription>
              {g.takers.length > 0 ? (
                g.takers.map((t, i) => (
                  <span key={t} className="block text-sm">
                    {i + 1}. {t}
                  </span>
                ))
              ) : (
                "Sin datos"
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
