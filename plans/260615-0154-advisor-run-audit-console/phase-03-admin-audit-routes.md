# Phase 03 — Admin audit routes (`/api/admin/advisor/runs*`)

## Overview
- **Priority:** P1. **Status:** ✅ Done. **Depends on:** 01
- Expose the run store over admin-gated HTTP. Simpler than `admin-chat-audit.ts` — advisor is in-process, so **no `?email=` proxy / Keycloak sub resolution**; runs already carry `owner`.

## Architecture
New Fastify plugin `server/src/routes/admin-advisor-audit.ts`, registered in `src/index.ts`. Every route: `requireRole('admin')` + `requireFeature('admin')` (mirror `admin-chat-audit.ts`).

Endpoints:
- `GET /api/admin/advisor/runs?game=&goal=&owner=&stopReason=&q=&limit=` → `RunSummary[]` (session_id, scope, goal, mode, owner, turn_count, total_cost_usd, final_stop_reason, had_error, created_at, last_active_at). Default order: `created_at DESC`, limit 500.
- `GET /api/admin/advisor/runs/:sessionId` → `{ run, turns: [{ ...turn, toolCalls: [...] }] }`.
- `GET /api/admin/advisor/runs/:sessionId/events?turnIndex=&cursor=&limit=` → `{ events, nextCursor }` (cursor-paginated, mirror chat raw-events pattern).
- `GET /api/admin/advisor/owners` → distinct owners (powers filter dropdown), admin-only.

## Related code files
**Create:** `server/src/routes/admin-advisor-audit.ts`.
**Modify:** `server/src/index.ts` (import + `await app.register(adminAdvisorAuditRoutes)` next to `adminChatAuditRoutes`).

## Implementation steps
1. Scaffold plugin; apply `requireRole`/`requireFeature` preHandlers (copy from `admin-chat-audit.ts`).
2. Wire the four routes to `advisor-run-store.ts` read APIs; validate query params (limit clamp, enum stopReason).
3. Register in `index.ts`.

## Todo
- [ ] `admin-advisor-audit.ts` with 4 routes + admin gating
- [ ] register in `index.ts`
- [ ] tests: 403 for non-admin; list shape + filters; detail shape (turns w/ toolCalls); events pagination (nextCursor)

## Success criteria
- Non-admin → 403 on all four routes; admin → 200 with correct shapes.
- `runs?stopReason=timeout` returns only timed-out runs; `?owner=` filters; `?q=` matches scope/goal.
- Detail returns turns each with their tool calls (incl. failed-with-error); events route paginates.

## Risks
| Risk | Mitigation |
|---|---|
| Leaking cross-user data to non-admin | Hard gate via `requireRole('admin')` + `requireFeature('admin')`, tested. |
| Large event payloads | Cursor pagination on events; cap `limit`. |

## Security
- Admin-only, read-only. Returns only allowlisted/PII-free persisted fields.
