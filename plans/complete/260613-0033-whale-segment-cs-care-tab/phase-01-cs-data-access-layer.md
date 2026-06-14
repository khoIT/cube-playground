# Phase 01 — CS data-access layer + game→product map

## Overview
- **Priority:** P0 (foundation)
- **Status:** pending
- Read-only Trino reader for `iceberg.cs_ticket`, scoped to a set of member uids + a product_id.

## Key insights
- Reuse existing `server/src/services/trino-rest-client.ts` (same conn the profiler uses). Do NOT add a new client.
- `cs_ticket_master` is broken (stale Iceberg metadata) → always `cs_ticket_new_master`.
- Coverage is partial by design; the reader returns matched rows only — callers compute the "X of N" ratio.

## Requirements
- Function: given `productId`, `uids: string[]`, `sinceDate` → returns per-ticket rows:
  `{ uid, ticketId, logDate, source, labelCategory, labelName, sentiment, rating, statusGroup }`.
- Aggregate helper: issue-mix counts by `labelCategory`; pulse counts (total tickets, distinct contacted uids,
  open/unresolved, negative-sentiment, ≤2-star).
- Batch uids safely into the `IN (...)` clause (chunk ≤ ~1000; segments cap ~few-hundred whales so usually 1 chunk).
- Match uids with `split_part(user_id,'@',1) IN (...)` to handle `@`-suffix identities.

## Related code files
- Create: `server/src/lakehouse/cs-ticket-reader.ts` (query builder + row mapper).
- Create: `server/src/config/cs-product-map.ts` — `{ jus_vn: 832, cfm_vn: 856 }` + `csCoverageGames()` helper.
- Read: `server/src/services/trino-rest-client.ts`, `server/src/services/trino-profiler-config.ts` (conn env).

## Implementation steps
1. Add `cs-product-map.ts` with the game→product_id map + `hasCsCoverage(gameId)`.
2. `cs-ticket-reader.ts`:
   - `fetchCsTickets({ productId, uids, sinceDate })` — single SQL joining
     `cs_ticket_info i` ⋈ `cs_ticket_new_master m` (ticket_id) ⟕ `cs_ticket_map_ai_label l` ⟕ `cs_map_status s`.
   - `summarizeCsTickets(rows)` — pure function → pulse + issue-mix (no Trino).
3. Guard: empty `uids` → return `[]` without hitting Trino.

## Todo
- [ ] cs-product-map.ts
- [ ] cs-ticket-reader.ts (fetch + summarize)
- [ ] uid chunking + `@`-suffix handling
- [ ] compile check (`npm run -w server build` or tsc)

## Success criteria
- Unit test: `summarizeCsTickets` over fixture rows produces correct pulse + mix.
- Manual: reader returns ~28 rows for the 252 jus_vn whale uids (matches this session's probe).

## Risks
- Trino cold latency → caller caches (Phase 02). Reader itself stays stateless.
- SQL injection via uids → uids are numeric/alphanumeric from our own store; still parameterize/escape (quote + reject non-`[A-Za-z0-9_-]`).
