"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Avatar de jugador con foto de la fuente. Si la URL falla (host caído,
 * hotlink bloqueado…) cae a un círculo con iniciales.
 */
export function PlayerAvatar({
  name,
  photoUrl,
  className,
}: {
  name: string;
  photoUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (!photoUrl || failed) {
    return (
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground",
          className,
        )}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URLs externas variables; el fallback con onError es suficiente
    <img
      src={photoUrl}
      alt={`Foto de ${name}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn("size-8 shrink-0 rounded-full object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
