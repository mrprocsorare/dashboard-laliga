"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthResult = {
  error: string | null;
  ok: boolean;
  notice?: string;
};

/** Inicia sesión con email + contraseña. */
export async function signIn(_prevState: AuthResult, formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Email y contraseña son obligatorios." };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

/**
 * Crea una cuenta. Con la confirmación de email activa en Supabase no habrá
 * sesión todavía y se informa al usuario de que revise su bandeja de entrada.
 */
export async function signUp(_prevState: AuthResult, formData: FormData): Promise<AuthResult> {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Email y contraseña son obligatorios." };
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");

  if (!data.session) {
    return {
      ok: false,
      error: null,
      notice: "Cuenta creada. Revisa tu email para confirmarla y luego entra.",
    };
  }

  return { ok: true, error: null };
}

/** Cierra la sesión. */
export async function signOut(): Promise<AuthResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}