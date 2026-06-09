# Admin Cost Observability — total app cost broken down by user / session / game / workspace

## Status: done (260607) — all tests pass (8 chat-service + 3 server + 4 FE), code-reviewed

## Decisions (user-confirmed 260607)
- Cost basis: stored `chat_turns.cost_usd` when present, fallback `tokens × flat env rates` for legacy NULL turns
- Time range: selectable 7d / 30d / 90d / all-time, default all-time
- UI: new Cost section inside existing `#/admin/observability` tab
- Drill depth: per-dimension breakdown tables + session list (top-N by cost), no per-turn view

## Key facts (verified)
- `chat_sessions`: owner_id, game_id, workspace (migrate.ts:49), owner_label, title, last_turn_at
- `chat_turns`: input/output_tokens, cost_usd, role, started_at; cache-hit turns persist tokens=0/cost=0 (replay-cached-turn.ts:95-97) → no double-count
- Internal bridge pattern: `x-internal-secret` gate (internal-stats.ts), server client degrades to null (chat-stats-client.ts)
- email↔sub: server `user_access.kc_sub` via listUsers(); chat.db has no email
- Flat rates: config.costPer1kInputUsd / costPer1kOutputUsd (chat-service/src/config.ts:265)

## Architecture
FE (observability tab) → `GET /api/admin/cost/summary?from&to&limit` (main server, admin-gated)
→ `GET /internal/cost-breakdown?from&to&limit` (chat-service, secret-gated)
→ SQL over chat_turns ⋈ chat_sessions, cost expr `COALESCE(cost_usd, tokens×rates)`, role='assistant'

## Files
chat-service:
1. `src/db/cost-breakdown-store.ts` (new) — queryCostBreakdown: total + by_owner/by_game/by_workspace + top-N sessions
2. `src/api/internal-cost.ts` (new) — secret-gated endpoint, from default 0 (all-time)
3. `src/index.ts` — register
4. `test/internal-cost.test.ts` (new) — aggregation correctness, stored-cost-vs-fallback, secret gate

server:
5. `src/services/chat-cost-client.ts` (new) — timeout + null degrade (mirror chat-stats-client)
6. `src/routes/admin-cost.ts` (new) — admin-gated, enrich sub→email
7. `src/index.ts` — register

FE:
8. `src/pages/Admin/hub/cost-observability-data.ts` (new) — types + useCostSummary(range)
9. `src/pages/Admin/hub/cost-breakdown-section.tsx` (new) — KPIs, range picker, dimension switcher, tables
10. `src/pages/Admin/hub/observability-tab.tsx` — mount section

## Todo
- [x] chat-service store + endpoint + register
- [x] chat-service tests pass (8)
- [x] server client + route + register + route test (3)
- [x] FE data hook + section + wiring + helper test (4)
- [x] typecheck both stacks (FE has pre-existing unrelated errors only)
- [x] code review (DONE_WITH_CONCERNS → resolved: status-filter intent documented, role+started_at index added)
- [ ] visual check in browser (main server 3004 not running during build; chat-service picked route up via tsx watch)

## Review follow-ups applied
- Documented in TURNS_IN_WINDOW: spend intentionally counts archived/compacted sessions (money is immutable)
- Added `idx_turns_role_started` index in migrate.ts for the all-time window scans
- Left as-is (reviewer agreed non-issues): per-dimension SUM never NULL on grouped rows; server relies on chat-service limit clamp (defense-in-depth)

## Success criteria
- Admin sees total cost (all-time default) + breakdown tables by user (email), session, game, workspace
- chat-service down → section shows "unreachable", page never 500s
- Legacy NULL-cost turns still counted via token fallback; cached turns cost 0
