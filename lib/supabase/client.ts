import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase del navegador (componentes client).
 * Solo se exponen variables con prefijo NEXT_PUBLIC_.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}