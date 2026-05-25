# Phase 06 — Debug API + Main-Server Proxy Pass-Through

## Context Links
- Existing routes pattern: `chat-service/src/api/sessions.ts:67-181` (owner-scoping idiom)
- Route registration: `chat-service/src/index.ts:27` (auditRoutes) and `chat-service/src/index.ts:61` (`fastify.register(auditRoutes, { db })`)
- Main-server proxy: `server/src/routes/chat.ts:298-329` (sessions GET proxy pattern; same shape needed for debug routes)
- Read helpers from Phase 03: `chat-service/src/db/observability-store.ts`

## Overview
- **Priority:** P0 — frontend cannot work without this.
- **Status:** complete
- **Brief:** New file `chat-service/src/api/debug.ts` exposes four GET routes for the triage UI. Main-server `chat.ts` proxies `/api/chat/debug/*` to chat-service `/debug/*`. All routes enforce X-Owner-Id ownership. NO modifications to existing `sessions.ts`.

## Key Insights
- The FE talks to `/api/chat/*` (vite-proxied to main-server :3004 → fetch'd to chat-service :3005). So FE must call `/api/chat/debug/*`. Main-server proxy MUST be extended — otherwise FE returns 404.
- Owner-scoping pattern at `sessions.ts:73-77` is the canonical idiom: read X-Owner-Id → 401 if absent → `getSession()` → 403 if `session.owner_id !== ownerId`. Replicate verbatim.
- `legacy` flag computation: a turn is "legacy" when there are zero rows in `llm_calls` AND zero in `tool_invocations` AND zero in `sdk_events` for that turnId. Compute via three `SELECT COUNT(*) WHERE turn_id = ?` (or one CTE) at session-detail read time.
- `sdk_events` pagination uses cursor = last seen `seq` (auto-increment column on the index). Keep eager-loaded routes (`/debug/turns/:turnId`) light — exclude sdk_events; force pagination.

## Requirements

### Functional — chat-service routes
| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/debug/sessions?game=&q=&limit=` | `ChatSessionRow[]` (owner-scoped) | Mirror of `listSessions()` but uses a new helper that does NOT filter by `status != 'archived'` (debug should see archived too). |
| GET | `/debug/sessions/:id` | `{ session, turns: TurnSummary[] }` | Each turn carries `legacy: boolean`, plus `llmCallCount`, `toolInvocationCount`. |
| GET | `/debug/turns/:turnId` | `{ turn, llmCalls: LlmCallRow[], toolInvocations: ToolInvocationRow[] }` | Eager; no sdk_events. |
| GET | `/debug/turns/:turnId/raw?cursor=&limit=` | `{ events: SdkEventRow[], nextCursor: number\|null }` | Default limit 200, max 1000. |

### Functional — main-server proxy additions (`server/src/routes/chat.ts`)
- `GET /api/chat/debug/sessions` → `${chatServiceUrl}/debug/sessions`
- `GET /api/chat/debug/sessions/:id` → `${chatServiceUrl}/debug/sessions/:id`
- `GET /api/chat/debug/turns/:turnId` → `${chatServiceUrl}/debug/turns/:turnId`
- `GET /api/chat/debug/turns/:turnId/raw` → `${chatServiceUrl}/debug/turns/:turnId/raw`
- All four use existing `proxyJson(url, 'GET', owner)` helper; preserve query string.

### Non-functional
- All routes return JSON.
- Ownership check fails with 403 (NOT 404) to match existing sessions.ts behaviour.
- `/debug/turns/:turnId` joins through `chat_turns → chat_sessions` to verify ownership (turn doesn't have owner_id directly). Use one query: `SELECT cs.owner_id FROM chat_sessions cs JOIN chat_turns ct ON ct.session_id = cs.id WHERE ct.id = ?`.
- File LOC: `debug.ts` < 180. If exceeded, split owner-scope guard helper into `debug-guards.ts`.

## Architecture

### Module layout
```
chat-service/src/api/
└── debug.ts                    (new, ~170 LOC)

chat-service/src/db/observability-store.ts
├── existing inserts (phase 03)
├── listLlmCallsByTurn(db, turnId)       (phase 03)
├── listToolInvocationsByTurn(db, turnId)(phase 03)
├── listSdkEventsByTurn(db, turnId, {cursor, limit})  (phase 03)
├── countObservabilityRowsByTurn(db, turnId): {llm: n, tool: n, sdk: n}   (NEW in phase 06)
└── listSessionsForDebug(db, {ownerId, gameId, q, limit})  (NEW in phase 06; ignores archived filter)
```

Helpers tagged "NEW in phase 06" are additions to the same `observability-store.ts` file from phase 03 — keep all observability read/write co-located. File budget stays < 200 LOC.

### Owner-scope helper (in debug.ts or split if needed)
```ts
function getTurnOwner(db, turnId): string | null {
  return db.prepare(`SELECT cs.owner_id FROM chat_sessions cs
                     JOIN chat_turns ct ON ct.session_id = cs.id
                     WHERE ct.id = ?`).get(turnId)?.owner_id ?? null;
}
```

### Data flow
```
FE GET /api/chat/debug/sessions ─► main-server chat.ts proxy ─► chat-service GET /debug/sessions
                                                            └─► observability-store helpers ─► SQLite
```

## Related Code Files

### Create
- `chat-service/src/api/debug.ts` (~170 LOC)

### Modify
- `chat-service/src/index.ts:27, 61` — import + register `debugRoutes`.
- `chat-service/src/db/observability-store.ts` (from phase 03) — add `countObservabilityRowsByTurn`, `listSessionsForDebug`.
- `server/src/routes/chat.ts` — add 4 GET proxies after existing chat routes (around line 421). Net additions ~60 LOC; file is already large, additive.

### Delete
- None.

## Implementation Steps
1. Add `countObservabilityRowsByTurn` + `listSessionsForDebug` to `observability-store.ts`.
2. Create `debug.ts` with the four routes and the owner-scope helper:
   - All routes require `X-Owner-Id` header → 401 if missing.
   - `/debug/sessions` → list helper + owner filter.
   - `/debug/sessions/:id` → getSession + 403/404 + listTurns + per-turn count → compute legacy flag.
   - `/debug/turns/:turnId` → getTurnOwner ownership check → assemble eager response.
   - `/debug/turns/:turnId/raw` → ownership check → paginated SDK events.
3. Register in `chat-service/src/index.ts` alongside `auditRoutes`.
4. Add 4 proxy handlers in `server/src/routes/chat.ts`. Pattern: copy the `GET /api/chat/sessions` handler block (~16 lines each).
5. Smoke test via curl: `curl -H 'X-Owner-Id: dev' http://localhost:3000/api/chat/debug/sessions?game=foo`.

## Todo List
- [x] Add count + debug-list helpers to `observability-store.ts`
- [x] Create `debug.ts` with 4 routes + owner-scope guard
- [x] Compute `legacy` flag per turn
- [x] Pagination cursor logic on `/raw`
- [x] Register routes in `index.ts`
- [x] Add 4 main-server proxies in `chat.ts`
- [ ] Verify 401 / 403 / 404 paths via tests (phase 08)
- [ ] Verify legacy detection (turn with no observability rows → legacy=true) (phase 08)

## Success Criteria
- `curl -H 'X-Owner-Id: dev' /api/chat/debug/sessions?game=g` returns owner's sessions including archived.
- Hitting `/api/chat/debug/sessions/:id` for another owner's session → 403.
- A new turn's session-detail response shows `legacy: false` with non-zero counts; an old (pre-feature) turn shows `legacy: true` and zero counts.
- `/debug/turns/:turnId/raw?cursor=0&limit=100` returns first 100 sdk_events ordered by seq, plus `nextCursor`.
- `debug.ts` file LOC < 180.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ownership join query is slow on large chat_turns | L | M | Index on `chat_turns.session_id` already exists (`idx_turns_session_index`). Single-row PK lookup on turn id. p99 < 1 ms. |
| Forgot to add the main-server proxy → FE 404 | M | H | Phase 08 test asserts proxy works end-to-end. Plus: phase-06 todo checklist explicitly lists proxy step. |
| `/debug/turns/:turnId` eager response too large (huge content_json) | M | M | Phase 03 truncated content_json at 64 KB; a turn with N=20 LLM calls × 64 KB = 1.3 MB max. Acceptable for debug UI. Note for future: paginate llm_calls if needed. |
| Cursor pagination off-by-one | L | L | Use `WHERE seq > ? ORDER BY seq ASC LIMIT ?`. nextCursor = last row's seq or null if returned < limit. |
| Proxy passes through any X-Owner-Id without validating against the user's session — privilege escalation via header forgery | M | H | NOT a regression — existing /api/chat/sessions has the same model and is approved by locked decision #4 (reuse X-Owner-Id). Dev-only triage tool. Document and move on. |

## Security Considerations
- All four routes enforce X-Owner-Id ownership at the chat-service layer (not just the proxy). Defence in depth.
- Returned payloads include `system_prompt_text`, raw assistant content, tool args — already owned by the same user; no escalation.
- `/dev/chat-audit` should be a dev-only feature. Phase 07 wraps the FE route in a build-time guard or a runtime banner ("Dev tooling — internal only"). NO new auth surface (locked decision #4); we rely on the existing X-Owner-Id discipline.

## Next Steps
- Phase 07 consumes these four endpoints.
- Phase 08 covers ownership-403 + legacy-flag tests.
- Optional follow-up: surface a "view in Langfuse" deep-link in the turn detail when `isLangfuseEnabled()` returns true (small enhancement; out of scope here).
