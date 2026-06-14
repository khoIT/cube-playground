# Phase 04 — Tests + docs + lessons

## Overview
- **Priority:** P1
- **Status:** pending
- Lock behavior with tests; record the join-coverage + broken-master gotchas.

## Requirements
- **Unit:** `summarizeCsTickets` (pulse/mix math), `riskScore` ordering, `csImpact` delta math + `smallSample` flag,
  `cs-product-map` gating.
- **Route:** `segment-cs-care` with mocked CS reader + recharge reader — assert payload shape, coverage ratio,
  degraded path (recharge throws → `csImpact:null`, 200 not 500), no-coverage game → empty/flagged.
- **UI:** care-tab renders all states (data / no-coverage / loading / degraded); watchlist sort; tokens present.
- Follow existing patterns in `server/test/segment-*.test.ts`.

## Related code files
- Create: `server/test/cs-ticket-reader.test.ts`, `server/test/segment-cs-care-route.test.ts`.
- Create: `src/pages/Segments/detail/tabs/__tests__/care-tab.test.tsx`.
- Edit: `docs/service-api-surface-map.md` (new endpoint), `docs/codebase-summary.md` (Care tab), `docs/lessons-learned.md`.

## Lessons to record
- `iceberg.cs_ticket.cs_ticket_master` has a stale Iceberg metadata pointer → use `cs_ticket_new_master`.
- CS↔segment join coverage ~8% (Facebook/AIHelp PSID not joinable) — surface honestly, never imply full coverage.
- `vip_id` in `cs_ticket_info` is a flag (=1), NOT a tier; real tier = `tier_id` (0–5) in `cs_ticket_realtime`.

## Todo
- [ ] server unit + route tests pass
- [ ] UI tests pass
- [ ] docs updated (api surface, summary, lessons)
- [ ] memory: add cs_ticket schema + join-key note

## Success criteria
- `npm test -w server` green for new suites; no regressions.
- Docs + lessons updated; a future reader can find the join key + coverage caveat without re-probing Trino.

## Unresolved questions
1. Confirm `user_id` is jus_vn canonical uid (role_id vs vopenid) against `mf_users` — format matches 1:1 but verify it's not coincidental.
2. Worth a later PSID→account bridge to lift Facebook coverage above 8%?
3. Should the Care tab also expose the warehouse `tier_id` (large-N) as an alternative VIP lens, or keep it segment-only?
