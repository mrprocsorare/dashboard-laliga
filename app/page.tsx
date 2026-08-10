import { redirect } from "next/navigation";
import SignOutButton from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  const [teamsRes, sourcesRes] = await Promise.all([
    supabase.from("teams").select("id, slug, name, short_name").order("name"),
    supabase
      .from("sources")
      .select("id, slug, name, enabled")
      .order("name"),
  ]);

  const teams = teamsRes.data ?? [];
  const sources = sourcesRes.data ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-6">
      <header className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <h1 className="text-lg font-semibold">Football Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Conectado como {user.email}
          </p>
        </div>
        <SignOutButton />
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Fuentes ({sources.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {sources.map((s) => (
            <Badge
              key={s.id}
              variant={s.enabled ? "default" : "outline"}
            >
              {s.name}
            </Badge>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Equipos de LaLiga ({teams.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {teams.map((t) => (
            <Card key={t.id} className="transition-colors hover:border-foreground/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.name}</CardTitle>
                <CardDescription>{t.short_name}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Contenido de ejemplo de la Fase 0. En fases siguientes cada equipo
          tendrá su detalle (alineación, consenso, lesiones, balón parado…).
        </p>
      </section>
    </main>
  );
}