# Phase 06 — Polish: Auto-Compact + Rate Limits + Cost Dashboard + LLM Titles + Rename/Delete

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§7 compact endpoint, §10 rate limit, §11 Phase 2 row, §12 token cost row, §15 owner-identity)
- Phase 01–05: full chain.
- Plan overview: `./plan.md`

## Overview

- **Priority:** P2 — hardening, not user-visible features. Required for daily-use stability.
- **Current status:** pending (blocked by all of 01–05).
- **Description:** Ship Phase-2 polish: auto-compact at 80 % context, per-owner rate limit middleware, cost dashboard endpoint, FE recovery on stream drop, LLM-summarised session titles, rename/delete affordances on session rows, optional MCP exposure of chat-service tools to other agents.

## Key Insights

- Brainstorm §7: `POST /sessions/:id/compact` summarises past N turns into a system note; starts a fresh SDK session that picks up with that summary.
- Brainstorm §10: env knobs already in `.env.example` from Phase 01 — `CHAT_MAX_TURNS_PER_SESSION=40`, `CHAT_MAX_TOKENS_PER_TURN=8000`, `CHAT_RATE_LIMIT_PER_OWNER_PER_MIN=30`. Phase 01 reads them; this phase enforces them.
- Brainstorm §8.6: Phase 2 generates a 3-word LLM summary after turn 3 to refine the auto-truncated first-message title.
- Brainstorm §12 token-cost row: per-turn token cap exists; cost dashboard is the visibility layer.
- Brainstorm §15 owner-identity Q: production hardening — re-verify a JWT instead of trusting `X-Owner-Id`. Defer the actual JWT decision to ops; this phase makes the contract pluggable.

## Requirements

### Functional

1. Auto-compact: when cumulative `total_input_tokens + total_output_tokens > 0.8 * CONTEXT_BUDGET` on a session, before next turn, chat-service runs a compact pass: summarise N turns → new SDK session with summary as preamble → mark old session `status='compacted'`, link `compacted_into` column.
2. Per-owner rate limit middleware in chat-service: token-bucket per `ownerId`, `CHAT_RATE_LIMIT_PER_OWNER_PER_MIN` reqs/min. Exceeds → 429 with `Retry-After`.
3. `GET /api/chat/stats?owner=<id>&from=<iso>&to=<iso>` returns aggregated `{ turns, input_tokens, output_tokens, cost_usd, by_skill }`. Phase 06 ships endpoint only; FE dashboard is a future ticket.
4. FE stream-drop recovery: if SSE stream cuts mid-turn (network blip), FE shows reconnect button; clicking re-fetches `GET /api/chat/sessions/:id` so user sees server-persisted state (or empty if turn never persisted). No automatic retry (avoid double-charge).
5. Session title refinement: after turn 3, chat-service triggers an out-of-band LLM call (small model) to produce a 3-word summary; updates `chat_sessions.title`; emits `gds-cube:chat-session-changed`.
6. Rename / delete affordances on `SessionRow`: kebab menu → Rename (inline edit) / Delete (soft-archive). Wire to `PATCH /api/chat/sessions/:id` + existing `DELETE /api/chat/sessions/:id`.
7. (Optional) MCP exposure: `chat-service/.claude/.mcp.json` so other agents (e.g., Monet) can call `preview_cube_query` over MCP. Gated behind env flag `CHAT_MCP_ENABLED`.

### Non-functional

- All Phase-1 tests remain green.
- Auto-compact does not lose mid-stream turn state (transaction-wrapped).
- Rate limit middleware adds < 1 ms overhead per request.
- LLM title call uses cheapest model available on the proxy.

## Architecture

```
Auto-compact trigger (per-turn pre-check):
  if session.total_tokens > 0.8 * BUDGET:
    1. read last N turns from chat_turns
    2. small-LLM call: "summarise this analyst conversation in 5 bullets, keep cube member names verbatim"
    3. create new session row with `parent_session_id`, status='active', title = old title
    4. insert system_preamble turn with the summary
    5. mark old session status='compacted', compacted_into = new id
    6. SSE first event: `compact_warning { from, to }`
    7. continue the turn against new session id

Rate limit middleware:
  bucket = tokenBuckets.get(ownerId) || new TokenBucket(refill=N/60s, max=N)
  if !bucket.tryConsume(1) → 429 { retry_after_ms: bucket.nextDrip() }
  else proceed

Title refinement (background, after turn 3):
  if session.turn_count === 3:
    fire-and-forget: prompt small LLM with concat of first 3 user msgs
    on response: UPDATE chat_sessions SET title = ?
    emit `gds-cube:chat-session-changed` via webhook? No — FE polls on its own next /sessions fetch.
    (Phase 06: FE just refetches on focus; no server-push.)
```

## Related Code Files

### MODIFY

- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/schema.sql` — ADD `parent_session_id`, `compacted_into` columns + migration step.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/migrate.ts` — versioned `ALTER TABLE` for new columns.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/turn.ts` — call `compact-if-needed` before runner.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/sessions.ts` — add `PATCH /:id` for rename.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/index.ts` — register rate-limit middleware + stats route + optional MCP.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/sse-stream.ts` — handle `compact_warning` event type.
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/chat.ts` — pass-through PATCH + stats; surface 429 from upstream.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/session-row.tsx` — kebab menu.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/hooks/use-chat-stream.ts` — handle stream-drop, surface reconnect state.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.env.example` — add `CHAT_CONTEXT_BUDGET_TOKENS=180000`, `CHAT_TITLE_MODEL=claude-3-5-haiku`, `CHAT_MCP_ENABLED=false`.

### CREATE

- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/compact-service.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/title-summariser.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/middleware/rate-limit.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/stats.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/.mcp.json` — optional, gated.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/compact-service.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/rate-limit.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/stats.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/title-summariser.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/session-row-menu.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/__tests__/session-row-menu.test.tsx`

### DELETE

None.

## Implementation Steps

### 1. Schema migration

1. Add columns `parent_session_id TEXT`, `compacted_into TEXT` to `chat_sessions`. Migrate idempotently.
2. Test: open existing DB → migrate → schema verified.

### 2. compact-service

1. `compact-service.ts`: `shouldCompact(session): boolean`, `compact(sessionId, ctx): Promise<{ newSessionId }>`.
2. Uses `title-summariser` patterns under the hood + a dedicated "summarise as bullets" prompt.
3. Test: fixture session at 0.85 budget → `shouldCompact` true → compact creates new session row, marks old status, inserts summary.

### 3. title-summariser

1. `title-summariser.ts`: `summariseTurns(turns, ctx): Promise<string>` — 3-word output. Uses cheaper model.
2. Background job hook in `turn.ts` after turn 3 (`if (turnCount === 3) queueMicrotask(() => summariseTitle(sessionId).catch(log))`).
3. Test with mocked SDK.

### 4. rate-limit middleware

1. `middleware/rate-limit.ts`: in-memory token-bucket map keyed by `ownerId`. `Fastify onRequest` hook.
2. 429 response includes `Retry-After` (seconds) + JSON body `{ code: 'rate_limited', retry_after_ms }`.
3. Test: 31 requests in 1 min → 31st returns 429.

### 5. stats endpoint

1. `api/stats.ts`: SQL aggregate over `chat_turns` filtered by owner + date range.
2. Server proxy passes through.
3. Test with fixture turns.

### 6. SSE compact_warning + FE reconnect

1. Extend `SseEvent` union with `compact_warning`.
2. `use-chat-stream.ts`: detect SSE EOF before `done` → set `status: 'disconnected'` + expose `reconnect()` that refetches the session.
3. UI: show "Connection lost — click to refresh" banner.

### 7. Rename/delete UI

1. `session-row-menu.tsx`: kebab → menu. Rename calls `PATCH /api/chat/sessions/:id` (chat-service implements + server passes through); Delete calls existing DELETE endpoint (already wired). Re-fetch list after.
2. Tests for menu interactions.

### 8. Optional MCP exposure

1. `chat-service/.claude/.mcp.json`: declare tools as MCP server (only if `CHAT_MCP_ENABLED=true`).
2. Skip default-on; document in README.

### 9. Wire + verify

1. `npm --prefix chat-service run typecheck && npm --prefix chat-service test`. Pass.
2. `npm run typecheck && npm run test`. Pass.
3. **Commits (suggested grouping):**
   - `feat(chat-service): auto-compact at 80% context`
   - `feat(chat-service): per-owner rate limit middleware`
   - `feat(chat-service): stats endpoint`
   - `feat(chat-service): LLM session-title summariser`
   - `feat(chat): SessionRow rename/delete affordances + stream-drop reconnect`
   - `feat(chat-service): optional MCP exposure (off by default)`

### 10. Manual smoke

1. Run a long session → cross 80 % → confirm compact_warning event and new session id.
2. Hammer `/api/chat/sessions/:id/turn` 35× in a minute → 429s start at request 31.
3. Hit `/api/chat/stats` → returns aggregated tokens.
4. Kill chat-service mid-stream → FE shows reconnect banner; clicking re-fetches state.
5. Send 3 user turns → after a few seconds session title updates to a 3-word summary.
6. Open session row menu → rename + delete work.

## Todo List

- [ ] 1. Schema migration: `parent_session_id`, `compacted_into`
- [ ] 2. `compact-service.ts` + test
- [ ] 3. `title-summariser.ts` + background hook + test
- [ ] 4. `rate-limit.ts` middleware + test
- [ ] 5. `stats.ts` endpoint + test + server proxy
- [ ] 6. SSE `compact_warning` event + FE reconnect handling
- [ ] 7. `SessionRowMenu` rename/delete + chat-service `PATCH /:id` + server proxy
- [ ] 8. Optional MCP `.mcp.json` (gated by `CHAT_MCP_ENABLED`)
- [ ] 9. Manual smoke for all 6 capabilities
- [ ] 10. Final `tsc --noEmit` clean across root, server, chat-service

## Success Criteria

- Long session > 80 % budget compacts automatically; no user-visible interruption beyond a `compact_warning` banner.
- Rate limit enforced at exactly the configured req/min/owner.
- Stats endpoint returns plausible numbers for a seeded fixture.
- FE recovers from stream drop without duplicate-charge.
- Session titles refine after 3 turns.
- Rename / delete buttons functional end-to-end.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Compact pass loses turn fidelity | Keep old session row intact (status='compacted'), only mark as ineligible for new turns. Summary is additive context. |
| Rate limit blocks legit power-users | Default 30/min/owner is generous; configurable per-owner via DB or env override later. |
| Title summariser cost runaway on many sessions | Only triggered once per session (at turn 3). Cap with `if title !== auto-truncated` skip. |
| MCP exposure leaks tools to other tenants | Off by default. README documents that enabling exposes tools globally; production hardening = separate auth layer (Phase 2+ infra). |
| Stream-drop reconnect double-fires turn persistence | Server-side append is idempotent on `turn_id`; FE never re-POSTs without explicit user action. |

## Security Considerations

- Rename / delete enforced server-side: chat-service refuses if `request.owner !== session.owner_id`. Tests cover.
- Rate limit uses `ownerId` from forwarded header — same dev posture as Phase 01; tightens in production deploy phase.
- `stats` endpoint refuses if `owner` query param != `request.owner` (or admin role; admin RBAC not in this phase — defer).
- Title summariser sends user message text to LLM → already governed by VNG LiteLLM proxy DLP. No new exposure surface.

## Next Steps

- Production deploy ticket (separate infra concern).
- Per-game master command divergence if vocabularies diverge.
- Optional analyst feedback loop on `compare`/`diagnose` quality → skill tuning.

## Unresolved Questions

1. Auto-compact threshold — 80 % matches Monet; consider lowering to 70 % if compaction quality drops. Leave configurable via env.
2. Should rate-limit middleware also apply to `GET /sessions` (read traffic)? Default Phase 06: only POST `/turn`.
3. Title summariser model choice — `claude-3-5-haiku` default; reviewer to confirm available on VNG LiteLLM proxy.
4. Production owner-identity hardening (JWT instead of trusted header) is **explicitly deferred** to infra phase.
