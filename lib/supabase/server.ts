import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente Supabase del lado servidor (Server Components / Server Actions).
 * Usa las cookies de la sesión. Debe invocarse dentro de operaciones que
 * tengan acceso al contexto de request (Server Component, Route Handler o
 * Server Action).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` puede fallar si se invoca desde un Server Component:
            // la sesión se refresca igualmente desde el middleware.
          }
        },
      },
    },
  );
}