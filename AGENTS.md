## Goal
- Dashboard automatizado de LaLiga (fantasía + Sorare). El pipeline de identidad Sorare y la visualización de precios de cartas (Classic/In-Season) están **completos y funcionando**. Mantener el repo público (GitHub Actions ilimitado y gratis) y no tocar ningún método de pago.

## Constraints & Preferences
- Never auto-associate medium/low → `manual_review` only
- Do NOT remove `players.sorareSlug`, `sorare_player_mappings`, or legacy scripts
- Import is upsert-only, never overwrites a correct existing `matched`; dry-run by default
- DB partial unique index (`WHERE status='matched'`) enforces ONE matched player per slug
- Fixed CSV columns for import: `sorare_player_id`, `sorare_slug`, `confidence`, `verification_status`, `verification_source`, `notes`
- El sync NUNCA downgradea un match con `isVerified=true` (regla: no pisar un matched correcto)
- Repo público: `mrprocsorare/dashboard-laliga` (rama `main`)

## Progress
### Done
- **Bug de precios Sorare corregido**: el precio pedido de una oferta de venta está en `receiverSide` (no en `senderSide`, que es la carta y vale 0). Fix en `lib/sorare-client.ts` (`positivePrice`) y `scripts/sync-sorare.ts` (`price()`). Orden de fuentes: `publicMinPrices` → `receiverSide` → `senderSide` → `bestBid` de subasta.
- **Import de identidades aplicado**: 89 mapeos human-verified de los `not_found` importados con `--apply`; 12 omitidos por colisión de slug (duplicados de la misma persona ya cubiertos).
- **Fix de durabilidad del sync**: la fase de re-verificación (`--force`) ahora omite cualquier `isVerified=true`, de modo que ni el cron diario ni un `--force` revierten coincidencias verificadas.
- **Cobertura final** (tras import + sync normal): 558 jugadores totales, **490 matched (87.8%)**, 7 manual_review, 61 not_found (residual = duplicados misma-persona + coaches/youth/ambiguos sin perfil Sorare).
- **Precios en caché**: 434/485 slugs matcheados tienen precio Classic/In-Season; los 51 restantes son jugadores sin lista de mercado activa en Sorare (null real, no bug).
- **Workflows GitHub Actions optimizados**: `scrape-fuentes` cada 15 min (`*/15 * * * *`), cache `node_modules`, `fetch-depth: 1`, `timeout 15`. `sorare.yml` y `odds.yml` con cache + `fetch-depth: 1`.
- **Auditoría completa en verde**: `lint` 0 errores, `typecheck` OK, `test` 117/117, `build` (5 rutas) OK.
- **Biwenger eliminada**: fuente no fiable. Fuera del registro de scrapers, del catálogo de `seed.ts` y de la BD (al salir del catálogo, `seed.ts` la borra en cascade con sus forecasts/eventos). Sus datos ya no inflan el consenso.
- **Bug de consenso de alineaciones corregido**: `services/persist.ts` marca como NO titular (prob 0) a los jugadores del roster que la fuente deja de listar en su alineación probable, evitando que filas antiguas congeladas inflen el consenso (caso Balde/FCB: pasó de ~alto a 0% tras re-scrape).
- **Próxima Jornada corregida**: `lib/odds.ts` agrupa partidos en jornadas por proximidad temporal (hueco > 3 días) en vez de `floor(index/10)`; `lib/data.ts`(`getJornadaData`) elige la jornada futura más próxima (no la de menor número guardado, que podía ser ya pasada). Requiere `ODDS_API_KEY` (solo en CI) para refrescar `match_odds`.

### In Progress
- Ninguno. Pipeline completo y estable.

### Blocked
- Ninguno funcionalmente. Los 61 `not_found` restantes son intencionados (duplicados de persona ya representada + coaches/youth/ambiguos sin perfil Sorare).

## Key Decisions
- Sorare slug = nombre registrado completo (todos los nombres + apellidos), minúsculas, sin acentos, guiones. Apodos (Pedri, Juanmi, Chupete) requieren el nombre completo.
- En oferta de venta: `senderSide` = carta (eurCents 0), `receiverSide` = precio pedido. El fix lee `receiverSide`.
- `getPlayers(slugs:)` es la confirmación fiable id+club+dob; `searchCards` es poco fiable.
- Misma persona real bajo dos `player_id` internos → ambas filas mapeadas a un Sorare player; el índice parcial bloquea un segundo `matched` que comparta slug, así el `player_id` secundario queda `not_found` (humano ya representado).
- `isVerified=true` (manual o auto) nunca se downgradea en el sync.
- Confianza: 0.90 para websearch/getPlayers confirmados; 0.70–0.75 para los 9 matches tempranos vía API.

## Next Steps
1. (Opcional) Mover los 61 `not_found` residuales a `manual_review` o dejarlos `not_found` (son coaches/youth/ambiguos).
2. (Opcional, fuera de alcance) Fusionar los `player_id` internos duplicados de las parejas misma-persona.
3. Mantenimiento rutinario: los cron mantienen datos frescos; el sync respeta la TTL y no pisa matches verificados.

## Critical Context
- **Cobertura**: 490/558 matched (87.8%); 7 manual_review; 61 not_found.
- **Precios**: 434/485 slugs con precio; 51 sin mercado activo.
- **Residual 61 not_found** = filas fuente duplicadas de la misma persona (slug ya matcheado a otro player_id, omitidas por el import) + perfiles genuinamente inexistentes (coaches como Bordalás, J. Alberto López, L. García; youth como Jorge Domínguez, Gamón, Miguel Auría; ambiguos como J. Castro, Chupete, S. José; sin perfil como Elijah Gift, Anai Morales, Jean Ives Valou).
- API Sorare: `lowestPriceAnyCard(inSeason, rarity: limited)` → `publicMinPrices`, `liveSingleSaleOffer` (`TokenOfferSide` con `amounts.eurCents`), `latestEnglishAuction.bestBid`. `PLAYER_BATCH_SIZE = SORARE_API_KEY ? 20 : 8`.
- Variables: `DATABASE_URL`, `SORARE_API_KEY` (presentes localmente).
- Cron: `sincronizar-sorare` diario `25 4 * * *`; `scrape-fuentes` cada 15 min `*/15 * * * *`; `actualizar-cuotas` cada 6h `0 */6 * * *`.
- Import script: `scripts/import-sorare-verified.ts` (dry-run por defecto; `--apply`; omite colisiones de slug y no pisa matches existentes).
- Legacy scripts/data preservados; `players.sorareSlug` intacto.

## Relevant Files
- `lib/sorare-client.ts`: query de precios + `positivePrice` (lee `receiverSide`)
- `scripts/sync-sorare.ts`: `price()` corregido; fase de re-verificación omite `isVerified`
- `tests/sorare.test.ts`: tests del bug de precio (23 tests)
- `.github/workflows/scrape.yml`: cron 15 min, cache, timeout 15
- `.github/workflows/sorare.yml`, `.github/workflows/odds.yml`: cache + fetch-depth 1
- `scripts/import-sorare-verified.ts`: import upsert-only de mapeos verificados
- `scripts/export-sorare-notfound.ts`, `resolve-sorare-bulk.ts`, `research-sorare-notfound.ts`, `gen-resolved-csv.ts`: herramientas de investigación (legacy)
- `data/sorare/verified_mappings.json` + `not_found_sorare_resolved.csv`: mapeos verificados (fuente del import)
- `components/dashboard/sorare-meta.tsx`: muestra Classic / In-Season
- `lib/sorare-types.ts`: `SorareCardPrice`, `SorarePlayerData`
- `database/schema.ts`: `playerSourceIds` (índice parcial `WHERE status='matched'`), `sorarePlayerCache`, `players.sorareSlug` (legacy)
