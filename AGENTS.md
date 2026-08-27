## Goal
- Complete the Sorare identity mapping for the 107 `not_found` players via web research (Sorare web pages for slug discovery + `getPlayers` for id/club/dob confirmation) and produce a verified CSV, validated by a dry-run import. Await explicit user approval before any DB write (`--apply`).

## Constraints & Preferences
- Max 100 requests/run; 12/min anon (no API key); 1 concurrent; Retry-After respected; clean stop at budget
- Never auto-associate medium/low → `manual_review` only (not used in this phase)
- Do NOT remove `players.sorareSlug`, `sorare_player_mappings`, or legacy scripts
- Import is upsert-only, never overwrites a correct existing `matched`; dry-run by default
- DB partial unique index (`WHERE status='matched'`) enforces ONE matched player per slug — two different player_ids can never both be matched to the same slug
- Fixed CSV columns for import: `sorare_player_id`, `sorare_slug`, `confidence`, `verification_status`, `verification_source`, `notes`
- No DB writes / no `--apply` yet for the researched mappings
- User delegated source choice ("eres tu el experto"): Sorare web + API primary, websearch as support

## Progress
### Done
- Migration 0010: `player_source_ids_source_slug_idx` changed to PARTIAL `WHERE status='matched'` (fixed apply crash) — applied earlier
- Re-applied sync: 442 matched, 9 manual_review, 107 not_found
- Scripts created: `export-sorare-notfound.ts`, `import-sorare-verified.ts`, `research-sorare-notfound.ts`, `resolve-sorare-bulk.ts` (slug-guess helper), `gen-resolved-csv.ts`; npm scripts `export:sorare-notfound`, `import:sorare-verified`
- Resolved **94 distinct humans** of 107 `not_found` via websearch + `getPlayers` confirmation
  - Includes same-human duplicate source rows mapped to one Sorare player: Benavídez/Protesoni, Dani Requena (Levante/Villarreal), Garrido/Rafita, Odisseas/Odysseas
  - `verified_mappings.json` = 95 entries (95 source rows = 94 distinct humans + 1 Odysseas duplicate row)
- `gen-resolved-csv.ts` → `data/sorare/not_found_sorare_resolved.csv` (95 rows)
- **Dry-run import validated**: 79 new rows to apply, 16 skipped (DB invariant: same slug already matched to another player_id, or within-file duplicate of an already-matched slug). All 16 are same-human duplicates already represented → safe to skip.
- typecheck clean (earlier); 115 tests pass

### In Progress
- Awaiting user approval to run `npm run import:sorare-verified -- --file data/sorare/not_found_sorare_resolved.csv --apply`
- User review of the 13 remaining unresolvable players

### Blocked
- None functionally. 13 players have no clear Sorare player profile (coaches / ambiguous / youth) — left for user.

## Key Decisions
- Sorare slug = full registered name (all given + surnames), lowercased, accents stripped, hyphen-joined. Nicknames (Pedri, Juanmi, Chupete) fail direct guess; full name required (e.g. `pedro-gonzalez-lopez`, `juan-miguel-jimenez-lopez`)
- `getPlayers(slugs:)` is the reliable id+club+dob confirmation; `searchCards` is unreliable (ranked by listings)
- websearch reliably returns the correct `sorare.com/football/players/<slug>`
- Confidence: 0.90 for websearch/getPlayers-confirmed (club+dob verified); 0.70–0.75 for the 9 early API (`searchCards`) matches
- Same real person under two internal `player_id`s (source-data duplicates) → both rows mapped to one Sorare player; the DB partial-unique-index still blocks a second matched row sharing the slug, so the secondary `player_id` stays `not_found` (human already represented)
- Import collision guard (slug already matched to a different player_id) is correct and must stay

## Next Steps
1. User approves → run import with `--apply`
2. Re-run `npm run audit:sorare` to confirm coverage (expect `not_found` to drop from 107 to ~28 rows = 13 distinct humans + 15 same-human duplicate rows, since 79 new matched)
3. User decides on the 13 remaining (move to `manual_review` or leave `not_found`)
4. Optionally merge duplicate internal `player_id`s for the 8 same-human pairs (separate data task, out of scope)

## Critical Context
- Coverage: 94/107 distinct humans resolved (~88%); 13 remain.
- Dry-run result: 79 to apply, 16 skipped (invariant). After `--apply`, `not_found` rows left = 107 − 79 = 28 (13 distinct humans + 15 duplicate rows of already-matched humans).
- **13 remaining unresolvable** (no clear Sorare player profile): Elijah Gift (Athletic, no profile), Jorge Domínguez (Atlético, youth no profile), Anai Morales (Osasuna, loan no profile), Miguel Auría (Osasuna Promesas, no profile), J. Castro (Alavés, unidentified), Bordalás (Getafe, coach), Jean Ives Valou (Getafe, no Sorare profile yet), Chupete (Málaga, unidentified), J. Alberto López (Racing, coach), S. José (Rayo, ambiguous), L. García (Sevilla, ambiguous/coach), Gamón (Valencia Mestalla, youth no profile). [Odysseas Vlachodimos duplicate now mapped]
- Backup: `C:/Users/mrcur/AppData/Local/Temp/opencode/sorare-backup-2026-08-25T07-15-36-001Z.json`
- Outputs: `data/sorare/verified_mappings.json` (95 entries), `data/sorare/not_found_sorare_resolved.csv` (95 rows)
- Import script: `scripts/import-sorare-verified.ts` (dry-run default; `--apply`; collision + don't-clobber-matched guards)
- Legacy scripts/data preserved; `players.sorareSlug` untouched.

## Relevant Files
- `database/schema.ts`: `playerSourceIds` (external_player_id, external_slug, partial unique index), `players.sorareSlug` (legacy), `sorarePlayerMappings` (legacy)
- `drizzle/0008_*.sql`, `0009_*.sql`, `0010_*.sql` (partial index)
- `scripts/sync-sorare.ts`, `scripts/audit-sorare.ts`
- `scripts/export-sorare-notfound.ts` → `data/sorare/not_found_sorare_2026-08-25T07-53-26-760Z.csv` (107 rows)
- `scripts/import-sorare-verified.ts` (dry-run/`--apply`, collision guards)
- `scripts/research-sorare-notfound.ts` (early API research, 9 verified)
- `scripts/resolve-sorare-bulk.ts` (slug-guess bulk helper), `scripts/gen-resolved-csv.ts` (generates resolved CSV from JSON map)
- `scripts/_probe.ts` (throwaway dev scratch script)
- `data/sorare/verified_mappings.json` (95 verified entries, source of truth)
- `data/sorare/not_found_sorare_resolved.csv` (95 generated rows)
- `lib/sorare-client.ts` (`searchCards` unreliable; `players(slugs:)` reliable; 12/min anon)
- `lib/sorare-slugs.ts` (`slugVariants`)
- `C:/Users/mrcur/AppData/Local/Temp/opencode/sorare-backup-2026-08-25T07-15-36-001Z.json`
- tests: 115 passing
