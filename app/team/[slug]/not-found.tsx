import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export default function TeamNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center p-6">
      <Card className="w-full">
        <CardContent className="space-y-3 py-8 text-center">
          <h1 className="text-lg font-semibold">Equipo no encontrado</h1>
          <p className="text-sm text-muted-foreground">
            No existe ningún equipo con ese identificador.
          </p>
          <Link href="/" className="text-sm font-medium hover:underline">
            ← Volver a todos los equipos
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
