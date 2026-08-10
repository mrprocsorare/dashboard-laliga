"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut, type AuthResult } from "@/app/auth/actions";

const initialState: AuthResult = { error: null, ok: false };

export default function SignOutButton() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signOut, initialState);

  useEffect(() => {
    if (state.ok) {
      router.push("/login");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <form action={formAction}>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Cerrar sesión
      </Button>
    </form>
  );
}