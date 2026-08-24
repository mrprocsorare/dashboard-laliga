This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Sorare

La integración usa la API GraphQL oficial desde un sincronizador backend (`lib/sorare-client.ts`); el navegador nunca llama directamente a Sorare. El dashboard lee `sorare_player_cache` desde Supabase y no genera consultas externas al abrir un equipo o jugador.

Los mappings se guardan en `sorare_player_mappings` y conservan `players.sorare_slug` por compatibilidad. Cada decisión incluye identidad remota, método, confianza, estado, candidatos y fecha de verificación. Solo se aplican coincidencias con evidencia suficiente; el resto queda en `manual_review` o `not_found`.

El cache conserva scores, media SO5, última puntuación y precios Limited Classic e In-Season por separado. Scores se actualizan cada 24 horas, cada edición de precios tiene su propio TTL de 24 horas y la identidad se revalida cada 7 días. Una respuesta fallida no elimina el último valor válido.

Tras aplicar la migración (`npm run db:migrate`), sincroniza los 20 equipos con:

```bash
npm run sync:sorare -- --apply
```

El proceso es idempotente y reutiliza mappings válidos. `--force` fuerza una nueva verificación de identidades y debe reservarse para una auditoría completa. Para revisar cobertura sin llamar a Sorare:

```bash
npm run audit:sorare
```

Para importar únicamente decisiones históricas previamente aceptadas y verificadas:

```bash
npm run import:sorare-review
```

`SORARE_API_KEY` es opcional y solo existe en backend. Sin clave el limitador se mantiene por debajo de 20 peticiones/minuto y usa lotes de 8 por el límite de complejidad; con clave usa hasta 180 peticiones/minuto, lotes de 20 y un presupuesto de 180 por ejecución. Los errores 429 respetan `Retry-After`, se detienen nuevas peticiones y no se registran secretos.

Las alineaciones siguen en su workflow de 15 minutos y no llaman al sincronizador Sorare. El workflow Sorare, cuando se habilita, se ejecuta una vez al día.

La herramienta antigua de CSV sigue disponible para revisiones especiales:

```bash
npm run map:sorare -- --assist --apply
```

Para auditar un CSV revisado sin escribir en la base de datos:

```bash
npm run audit:sorare-mapping -- --input "sorare-mapping-review OK.csv"
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
