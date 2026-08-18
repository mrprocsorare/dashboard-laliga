import type { ReactNode } from "react";
import Link from "next/link";
import { MainNav } from "@/components/dashboard/main-nav";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";

/**
 * Estructura común del dashboard: header sticky con backdrop-blur + contenedor
 * centrado con padding consistente. Pensado para que ambos layouts (home y
 * detalle de equipo) compartieran la misma chimenea visual.
 */
export function DashboardShell({
  email,
  children,
}: {
  email?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="text-base font-semibold hover:underline">
              <span className="hidden sm:inline">Dashboard LaLiga</span>
              <span className="sm:hidden">LaLiga</span>
            </Link>
            {email ? (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                · {email}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <MainNav />
            <ThemeToggle />
          </div>
        </header>
      </div>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}
