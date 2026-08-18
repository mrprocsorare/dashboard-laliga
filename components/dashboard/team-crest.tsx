"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// IDs del CDN de escudos de football-data.org. logoUrl permite sustituirlos
// cuando el catálogo de Supabase tenga una URL propia del club.
const DEFAULT_CRESTS: Record<string, string> = {
  alaves: "https://crests.football-data.org/263.svg",
  "athletic-bilbao": "https://crests.football-data.org/77.svg",
  "atletico-madrid": "https://crests.football-data.org/78.svg",
  barcelona: "https://crests.football-data.org/81.svg",
  "real-betis": "https://crests.football-data.org/90.svg",
  "celta-vigo": "https://crests.football-data.org/558.svg",
  "deportivo-la-coruna": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZh5Fh0XtzUfdYgfiSGWlL6tLZqy5qg6jG-KffVAa7tA&s=10",
  elche: "https://crests.football-data.org/285.svg",
  espanyol: "https://crests.football-data.org/80.svg",
  getafe: "https://crests.football-data.org/82.svg",
  levante: "https://crests.football-data.org/88.svg",
  malaga: "https://crests.football-data.org/84.svg",
  osasuna: "https://crests.football-data.org/79.svg",
  "racing-santander": "https://comprarpegatinas.com/images/stories/virtuemart/product/pegatinas/Racing_Santander.png",
  "rayo-vallecano": "https://crests.football-data.org/87.svg",
  "real-madrid": "https://crests.football-data.org/86.svg",
  "real-sociedad": "https://crests.football-data.org/92.svg",
  sevilla: "https://crests.football-data.org/559.svg",
  valencia: "https://crests.football-data.org/95.svg",
  villarreal: "https://crests.football-data.org/94.svg",
};

export function TeamCrest({
  slug,
  name,
  logoUrl,
  className,
}: {
  slug: string | null;
  name: string;
  logoUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const source = logoUrl ?? (slug ? DEFAULT_CRESTS[slug] : null);
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 p-1",
        className,
      )}
    >
      {source && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- fuente externa con fallback visual
        <img
          src={source}
          alt={`Escudo de ${name}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[10px] font-bold text-muted-foreground">{initials}</span>
      )}
    </span>
  );
}
