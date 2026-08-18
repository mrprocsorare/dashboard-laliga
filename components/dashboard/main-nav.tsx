"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Equipos" },
  { href: "/jornada", label: "Próxima Jornada" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación principal" className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
      {links.map((link) => {
        const active = link.href === "/" ? pathname === "/" || pathname.startsWith("/team/") : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
