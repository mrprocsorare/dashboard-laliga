import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/dashboard/app-header";
import {
  EventTypeBadge,
  PositionBadge,
  ProbabilityBadge,
  SeverityLabel,
} from "@/components/dashboard/badges";
import { PlayerAvatar } from "@/components/dashboard/player-avatar";
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
  getTeamData,
  type PlayerWithConsensus,
  type Severity,
  type TeamEvent,
} from "@/lib/data";
import { formatDateTime, timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const data = await getTeamData(slug);
  if (!data) {
    notFound();
  }

  const { team, players, events, teamConsensus } = data;
  const withConsensus = players.filter((p) => p.consensus);
  const starters = withConsensus.slice(0, 11);
  const bench = withConsensus.slice(11);
  const sortedEvents = [...events].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.recordedAt.localeCompare(a.recordedAt),
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 p-6">
      <AppHeader email={user.email} />

      <div className="space-y-2">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Todos los equipos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{team.name}</h1>
          {teamConsensus?.formation ? (
            <span className="rounded-md border px-2 py-0.5 text-sm">
              {teamConsensus.formation}
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
            Consenso actualizado {timeAgo(withConsensus[0].consensus!.updated_at)}
          </p>
        ) : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Once de consenso
        </h2>
        {starters.length > 0 ? (
          <Card>
            <CardContent>
              <PlayersTable players={starters} />
            </CardContent>
          </Card>
        ) : (
          <EmptyCard text="Todavía no hay previsiones de ninguna fuente para este equipo." />
        )}
      </section>

      {bench.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Resto de la convocatoria ({bench.length})
          </h2>
          <Card>
            <CardContent>
              <PlayersTable players={bench} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
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
          <EmptyCard text="Sin eventos recientes (ventana de 48 h)." />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Balón parado
        </h2>
        <SetPiecesCard teamConsensus={teamConsensus} />
      </section>
    </main>
  );
}

function PlayersTable({ players }: { players: PlayerWithConsensus[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Jugador</TableHead>
          <TableHead>Pos</TableHead>
          <TableHead>Consenso</TableHead>
          <TableHead>Fuentes</TableHead>
          <TableHead className="w-full">Detalle por fuente</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.map((p) => {
          const c = p.consensus!;
          return (
            <TableRow key={p.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <PlayerAvatar name={p.name} photoUrl={p.photo_url} />
                  <span className="font-medium whitespace-normal">{p.name}</span>
                </span>
              </TableCell>
              <TableCell>
                <PositionBadge position={p.position} />
              </TableCell>
              <TableCell>
                <ProbabilityBadge pct={c.probability_pct} />
              </TableCell>
              <TableCell>
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  title={`${c.sources_starter} de ${c.sources_total} fuentes lo consideran titular`}
                >
                  {c.sources_starter}/{c.sources_total} titular
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {c.agreement.map((a) => (
                    <span
                      key={a.source}
                      className="text-xs text-muted-foreground tabular-nums"
                      title={`Actualizado ${formatDateTime(a.fetched_at)}`}
                    >
                      {a.source} <span className="font-medium text-foreground">{a.probability}%</span>
                    </span>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
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
  teamConsensus: { set_pieces: { penalty: string[]; corner: string[]; free_kick: string[] } | null } | null;
}) {
  const pieces = teamConsensus?.set_pieces;
  const groups: { title: string; takers: string[] }[] = [
    { title: "Penalti", takers: pieces?.penalty ?? [] },
    { title: "Córner", takers: pieces?.corner ?? [] },
    { title: "Falta", takers: pieces?.free_kick ?? [] },
  ];
  const hasAny = groups.some((g) => g.takers.length > 0);

  if (!hasAny) {
    return <EmptyCard text="Sin datos de lanzadores todavía." />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader>
            <CardTitle>{g.title}</CardTitle>
            <CardDescription>
              {g.takers.length > 0
                ? g.takers.map((t, i) => (
                    <span key={t} className="block text-sm">
                      {i + 1}. {t}
                    </span>
                  ))
                : "Sin datos"}
            </CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="py-6 text-center text-sm text-muted-foreground">
        {text}
      </CardContent>
    </Card>
  );
}
