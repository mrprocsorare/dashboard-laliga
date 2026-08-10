"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp, type AuthResult } from "@/app/auth/actions";

const initialState: AuthResult = { error: null, ok: false };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      router.push("/");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Football Dashboard</CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Inicia sesión para acceder"
              : "Crea tu cuenta para acceder"}
          </CardDescription>
        </CardHeader>

        <form action={formAction}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="tu@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                placeholder="••••••••"
              />
            </div>

            {state.error ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}
            {state.notice ? (
              <p className="text-sm text-muted-foreground">{state.notice}</p>
            ) : null}
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={pending}>
              {pending
                ? "Procesando…"
                : mode === "signin"
                  ? "Entrar"
                  : "Crear cuenta"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-sm"
              onClick={() => {
                setMode((m) => (m === "signin" ? "signup" : "signin"));
              }}
            >
              {mode === "signin"
                ? "¿Aún no tienes cuenta? Regístrate"
                : "¿Ya tienes cuenta? Inicia sesión"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}