import type { ReactNode } from "react";
import Link from "next/link";
import SignOutButton from "@/components/auth/sign-out-button";

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
          <div className="flex items-baseline gap-2">
            <Link href="/" className="text-base font-semibold hover:underline">
              Dashboard LaLiga
            </Link>
            {email ? (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                · {email}
              </span>
            ) : null}
          </div>
          <SignOutButton />
        </header>
      </div>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}