import { DashboardShell } from "@/components/dashboard/shell";
import { JornadaView } from "@/components/dashboard/jornada-view";
import { Card, CardContent } from "@/components/ui/card";
import { getJornadaData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function JornadaPage() {
  const data = await getJornadaData();

  return (
    <DashboardShell>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Próxima Jornada</p>
        <h1 className="text-3xl font-semibold tracking-tight">Alineaciones y pronósticos</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Selecciona un partido para consultar el XI más probable y las probabilidades 1X2 del mercado.
        </p>
      </div>

      {!data.matches.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Todavía no hay partidos de LaLiga disponibles.
          </CardContent>
        </Card>
      ) : (
        <JornadaView matches={data.matches} />
      )}
    </DashboardShell>
  );
}
