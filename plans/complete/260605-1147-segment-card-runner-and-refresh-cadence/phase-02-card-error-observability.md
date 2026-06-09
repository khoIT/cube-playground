# Phase 02 — Per-card error observability

**Item:** (4) A card that errors is `console.warn`'d server-side and silently dropped; FE
then live-fetches with no signal. "Why is this tile slow/blank?" is invisible.
**Priority:** High. **Status:** ⬜ planned. **Layer:** server (schema + runner + API) + FE (read).

## Context links
- server/src/services/card-runner.ts (catch block ~L158-162 — only logs)
- server/src/services/card-cache-store.ts (`upsertCardCache` L25-62, `getCardCache` L65-76)
- server/src/db/migrations/003-card-cache.sql (table: segment_id, card_id, query_hash, rows_json, fetched_at — **no status/error column**)
- server/src/routes/segments.ts (GET /:id L382-388 returns `card_cache: getCardCache(id)`)
- src/types/segment-api.ts (`CardCacheEntry { rows, fetched_at }` L49-52)

## Overview
Persist a per-card **status** so a failed/stale card is a first-class record instead of an
absence. Cheapest correct shape: add `status` + `error` columns to `segment_card_cache`, write
`'ok'` rows for successes and `'error'` rows (rows_json `[]`, error message) for caught
failures. API returns them; FE can show a subtle "couldn't refresh — using live data" hint.

## Key insights
- Today a failed card writes NOTHING → indistinguishable from "never ran". A status column
  disambiguates: `ok` / `error` (and `fetched_at` already gives recency).
- Minimal blast radius: `getCardCache` return shape gains `status`/`error`; FE type extends
  with optional fields → backward compatible (older cache rows default `status='ok'`).
- Do NOT block refresh on card errors (existing contract: cards are best-effort). Just record.

## Requirements
- Migration adds `status TEXT NOT NULL DEFAULT 'ok'` and `error TEXT` to `segment_card_cache`.
- `runPresetCards` returns failure entries too: `{ cardId, queryHash, rows: [], status: 'error', error: msg }`.
- `upsertCardCache` writes status+error; `getCardCache` returns them.
- API response per card: `{ rows, fetched_at, status, error? }`.
- FE: optional badge on a card whose `status === 'error'` (Phase 04 may co-locate this).

## Architecture
- New migration `server/src/db/migrations/00X-card-cache-status.sql` (domain slug only — NO
  phase number in filename per repo rule): `ALTER TABLE segment_card_cache ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'; ALTER TABLE segment_card_cache ADD COLUMN error TEXT;`
- `CardCacheEntry` (server) gains `status: 'ok' | 'error'` + `error?: string`.
- card-runner: success path sets `status:'ok'`; catch path returns an error entry (NOT null)
  so it persists. (Note: this interacts with Phase 01 — worker returns the error entry instead
  of null; the `.filter` then keeps it. Decide: keep error entries in cache, yes.)

## Related code files
- Create: `server/src/db/migrations/00X-card-cache-status.sql`
- Modify: `card-runner.ts`, `card-cache-store.ts`, `routes/segments.ts` (type only), `src/types/segment-api.ts`
- Modify (light FE): the KPI/chart card components to read `status` (full UX in Phase 04)
- Test: extend `server/test/` card-cache + card-runner tests for error-row round-trip

## Implementation steps
1. Write migration adding `status` + `error`; confirm migration runner picks up new file.
2. Extend server `CardCacheEntry` + `upsertCardCache` INSERT (and ON CONFLICT) to carry both.
3. card-runner: in catch, return `{ cardId, queryHash: hashQuery(physical), rows: [], status: 'error', error: (err as Error).message }`; success returns `status: 'ok'`.
4. `getCardCache` returns `{ rows, fetched_at, status, error }` per card.
5. FE type: `CardCacheEntry { rows; fetched_at; status?: 'ok'|'error'; error?: string }`.
6. Tests: error entry persists + round-trips; existing ok-path unchanged.

## Todo
- [ ] Migration (status default 'ok', error nullable)
- [ ] Server type + store read/write
- [ ] card-runner persists error entries
- [ ] API + FE types updated
- [ ] Tests: error round-trip, ok-path regression
- [ ] Typecheck both sides

## Success criteria
- A card forced to fail shows `status:'error'` in GET /:id `card_cache`; ok cards unchanged.
- Re-running a now-succeeding card flips its row back to `status:'ok'`, clears `error`.

## Risk assessment
- **Migration on existing DBs** → additive columns with defaults, no backfill needed.
- **Interaction w/ Phase 01** → coordinate: worker returns error entry (not null) so it persists.
- **Cache growth** → bounded (one row per card per segment, PK already enforces).

## Security
- `error` stores Cube error messages — ensure no token/secret leaks into them (Cube errors are
  query-text/schema messages; verify none echo the JWT). Truncate to ~500 chars.

## Next steps
- Phase 04 surfaces `status` + `fetched_at` as the user-facing freshness/health hint.

## Open questions
- Keep error entries forever or let the retention pruner clear them? (lean: same retention as ok rows.)
