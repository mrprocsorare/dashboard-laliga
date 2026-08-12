import Link from "next/link";
import SignOutButton from "@/components/auth/sign-out-button";

/** Cabecera común del dashboard: título, usuario y cierre de sesión. */
export function AppHeader({ email }: { email?: string | null }) {
  return (
    <header className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div>
        <Link href="/" className="text-lg font-semibold hover:underline">
          Dashboard LaLiga
        </Link>
        {email ? (
          <p className="text-sm text-muted-foreground">Conectado como {email}</p>
        ) : null}
      </div>
      <SignOutButton />
    </header>
  );
}
