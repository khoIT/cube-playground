# Phase 06 — Agent runtime foundation

## Context links
- SDK research (this session): `@anthropic-ai/claude-agent-sdk` v0.3.170+, `query()` entry, OAuth lane, in-process MCP tools, async-iterator streaming, `maxTurns`/`maxBudgetUsd`/`canUseTool`/`permissionMode` guardrails.
- Reuse: auth-mode concept `server/src/services/chat-llm-auth-client.ts:12` (`LlmAuthMode = 'auto'|'gateway'|'subscription'`); SSE pattern `server/src/routes/chat.ts:248-256` (`reply.raw.writeHead(200, {'Content-Type':'text/event-stream', ...})`, `reply.raw.on('close', …)`).
- Guardrail/lifecycle DESIGN reference (read-only, do NOT reuse the subprocess code): `/Users/lap16299/Documents/code/cube-advisor/backend/src/runner/runner.ts:28-62` (cost/timeout ceiling, --resume, JSON artifact).
- Routes are Fastify (`app.post(...)`, `server/src/routes/advisor.ts:79`).

## Overview
- **Priority:** P1. **Status:** ✅ done (2026-06-15). **Depends on:** 0–4 (the tool layer exists).
- Stand up a dedicated **in-process Claude Agent SDK runtime** under `server/src/advisor/agent/`: OAuth-token auth, multi-turn session lifecycle, SSE streaming to the client, and hard guardrails (cost / turn / timeout caps, allowlist-only tools, prompt-injection + runaway guards, audit log). **No tools are wired here** (Phase 7) — this phase delivers the harness with a single trivial echo/no-op tool to prove the loop end-to-end.

**Delivered (2026-06-15):** `@anthropic-ai/claude-agent-sdk@0.3.177` added; this forced `zod` ^3.23.8 → ^4.0.0 (SDK peer; 8 `z.record(V)`→`z.record(z.string(),V)` migration sites; full suite regression-checked green). New `server/src/advisor/agent/`: `agent-types.ts`, `agent-system-prompt.ts` (business-user "Guided Drive" prompt), `agent-oauth-env.ts` (clean spawn env via SDK per-query `env` option — strips API-key/gateway vars, never mutates global process.env; OAuth lane always wins), `agent-guardrails.ts` (caps + deny-by-default `canUseTool`), `agent-inbound-guard.ts` (email redaction + injection sanitize; deliberately NO digit redaction — advisor reasons on large VND/count figures), `agent-event-normalizer.ts` (sole SDK-shape-aware module), `agent-input-queue.ts`, `agent-runtime.ts` (multi-turn streaming-input single query; **two-level stop: `interruptTurn()` aborts the in-flight turn keeping the session resumable, `abort()` closes the session**), `agent-session-registry.ts`. Routes: `POST /api/advisor/agent/turn` (SSE, mirrors chat.ts) + `GET /api/advisor/agent/session/:id`; write-gated. 38 new tests (incl stubbed-query runtime loop/timeout/budget/abort); tsc clean; full suite 1587/1587. **DEFERRED to a token-bearing host:** the live OAuth smoke + the precise SDK `interrupt()`→resume behavior (Phase 9). Code-review fix-then-ship: S2 (disconnect was closing the whole session → now turn-only interrupt, resumable), S1 (runtime loop untested → stubbed-query test added), N1 (busy claimed synchronously in route), N2 (write guarded vs closed socket), M1 (owner audited), M2 (digit redaction dropped).

**Agent flow design (resolves plan Q-A5 — "auto-start vs explicit Drive"): "Guided Drive" for business users.** A non-technical game BM states a goal in one sentence (or picks Revenue/Engagement) + a scope, then presses **Investigate** — they are NOT expected to know what to ask. The agent then drives the causal chain (Opportunity→Target→Cause→Lever→Proof) proactively, narrating each step in plain business language. Explicit press, not page-load auto-fire (preserves Explore-first). Steering is a plain-language follow-up on the same session (mode `steer`); a one-off question is `explore`. New session defaults to `drive`, a resumed session to `steer`. The base system prompt (`agent-system-prompt.ts`) encodes this; Phase 8 wires it to the stage UI.

## Key insights
- The SDK reads `CLAUDE_CODE_OAUTH_TOKEN` automatically, but **`ANTHROPIC_API_KEY` takes precedence if set** (SDK auth precedence #3 > #5). The runtime MUST guarantee the OAuth lane wins: unset/ignore API-key envs in the agent's spawn env, mirroring how `chat-llm-auth-client` forces `subscription` mode. This is a correctness requirement, not cosmetic — silently falling back to the gateway key would lock the agent to sonnet-only.
- The SDK still spawns a bundled subprocess under the hood for the LLM call; our **tools run in-process** (`createSdkMcpServer`). Each `query()` = fresh subprocess (~100 ms). Lifetime: **one session per investigation**, not per HTTP request — multi-turn steering needs the same session.
- This host HAS the OAuth token (host dev service); Docker does not. Live agent smoke runs locally via OAuth; live Cube reads still need a Cube-connected host. Both noted in success criteria.

## Requirements
**Functional**
1. `createAdvisorAgentSession(opts)` → a session object holding an SDK streaming-input `query()` driven by an async-iterator input queue (multi-turn, `--resume`-equivalent via persistent streaming input, NOT single-shot `continue:true` — streaming-input is the only mode that supports interruption + queued follow-ups per SDK research §5).
2. Auth: pin to OAuth lane. Build the agent spawn env from a clean base (no `ANTHROPIC_API_KEY` / gateway token); require `CLAUDE_CODE_OAUTH_TOKEN`; fail fast with a clear error if absent. Model selectable (default the full Opus-class model the OAuth lane unlocks; configurable via env).
3. Streaming: expose an async-iterator of normalized runtime events (`assistant_delta`, `tool_call`, `tool_result`, `cost`, `done`, `error`, `denied`) decoupled from raw SDK message shapes, so the UI bridge + tests don't depend on SDK internals.
4. SSE bridge: `POST /api/advisor/agent/turn` (Fastify, `reply.raw` SSE per chat.ts pattern) streams those events; `reply.raw.on('close')` aborts the session via `AbortController`.
5. Session registry: in-memory map `sessionId → session` with TTL eviction; `POST /api/advisor/agent/turn` resumes an existing `sessionId` or creates one. Concurrency-safe (one in-flight turn per session; queue or reject overlapping turns).
6. Guardrails (all enforced at the harness, not the prompt): `maxTurns`, `maxBudgetUsd`, wall-clock `timeoutMs` (via `AbortSignal`), `permissionMode:'default'` + empty built-in `tools:[]` (no Bash/Edit/Read filesystem tools — agent gets ONLY our MCP tools, wired Phase 7), `canUseTool` callback hook point (allowlist; Phase 7 fills the real allowlist).
7. Audit log: every turn writes start/end, tool calls (name only here), token + ₫ cost, stop reason, abort cause to a structured log (reuse existing logger). No PII.
8. Prompt-injection guard seam: a `sanitizeInbound(text)` hook on user text + (Phase 7) tool outputs — strips/escapes instruction-injection patterns before they enter agent context; here it is a pass-through stub with the seam + a unit test.

**Non-functional:** files <200 LOC (split harness / session-registry / sse-bridge / event-normalizer / guardrails-config); kebab-case; no plan-artifact strings in code/comments.

## Architecture — data flow
```
client POST /api/advisor/agent/turn {sessionId?, message, scope, goal}
  → resolve/create session (registry)            ── WorkspaceCtx from workspace-header middleware
  → redact + sanitize inbound message
  → push message onto session input async-iterator
  → SDK query() streams SDKMessage*  ── tools (Phase 7) execute in-process
  → event-normalizer → {assistant_delta|tool_call|tool_result|cost|done|error}
  → SSE writer → reply.raw  (event: <type>\ndata: <json>\n\n)
  → on guardrail trip (turns/budget/timeout/denied) → emit error event + abort
  → audit-log writes turn summary
```

## Related code files
**Create** (`server/src/advisor/agent/`):
- `agent-runtime.ts` — `createAdvisorAgentSession`, OAuth env builder, `query()` wiring, model select.
- `agent-session-registry.ts` — in-memory `sessionId→session`, TTL, concurrency lock.
- `agent-event-normalizer.ts` — SDK `SDKMessage` → normalized runtime event union.
- `agent-guardrails.ts` — caps config + `AbortController` wiring + `canUseTool` allowlist scaffold.
- `agent-inbound-guard.ts` — `redactInbound` (PII allowlist) + `sanitizeInbound` (injection) seams.
- `agent-audit-log.ts` — structured per-turn audit writer.
- `agent-types.ts` — shared types (RuntimeEvent, SessionOpts, TurnRequest).

**Modify:**
- `server/src/routes/advisor.ts` — add `POST /api/advisor/agent/turn` SSE route + `GET /api/advisor/agent/session/:id` (status/cost). Keep existing routes untouched.
- `package.json` — add `@anthropic-ai/claude-agent-sdk` + `zod` (zod likely already present — verify, don't duplicate).
- env docs only (no secrets committed): document `CLAUDE_CODE_OAUTH_TOKEN`, `ADVISOR_AGENT_MODEL`, `ADVISOR_AGENT_MAX_TURNS`, `ADVISOR_AGENT_MAX_BUDGET_USD`, `ADVISOR_AGENT_TIMEOUT_MS`.

## Implementation steps
1. Add SDK dep; confirm zod present; pin SDK version.
2. `agent-types.ts` → the RuntimeEvent union + opts.
3. `agent-runtime.ts`: OAuth env builder (clean env, assert token, strip API-key vars) → `query()` with streaming-input async-iterator, `tools:[]`, `mcpServers:{}` (filled Phase 7), `permissionMode:'default'`, caps from guardrails config.
4. `agent-event-normalizer.ts`: map `assistant` / `tool_progress` / `result(success|error_max_turns|timeout)` / `permission_denied` → normalized events; surface `total_cost_usd` on `cost`/`done`.
5. `agent-guardrails.ts`: `maxTurns`, `maxBudgetUsd`, `timeoutMs`→`AbortController`; `canUseTool` allowlist scaffold (deny-by-default).
6. `agent-session-registry.ts`: create/resume/evict; one in-flight turn lock.
7. `agent-inbound-guard.ts`: `redactInbound` (reuse ranked-members allowlist shape) + `sanitizeInbound` stub + tests.
8. `agent-audit-log.ts`: per-turn structured record.
9. SSE route in `routes/advisor.ts` mirroring chat.ts (`reply.raw.writeHead`, close→abort).
10. Echo no-op tool ONLY to prove the loop; remove or leave as a health tool.
11. `npm run build` / tsc clean.

## Todo
- [x] add SDK dep (+bump zod to ^4); pin version (0.3.177)
- [x] agent-types RuntimeEvent union
- [x] agent-runtime: OAuth env builder + query() streaming-input + caps
- [x] event-normalizer (incl cost + stop reasons)
- [x] guardrails: turns/budget/timeout/abort + canUseTool deny-by-default scaffold
- [x] session-registry: create/resume/evict + in-flight lock
- [x] inbound-guard: redact + sanitize seams + tests
- [x] audit-log per turn (incl owner)
- [x] SSE route POST /api/advisor/agent/turn + GET session status
- [x] tsc/build clean; 38 new unit tests (full suite 1587/1587)
- [ ] local OAuth smoke (echo tool round-trip) — DEFERRED to a token-bearing host

## Success criteria (measurable)
- **OAuth lane proven:** local smoke on THIS host — a turn round-trips through the live OAuth lane and the audit log shows the full model (not sonnet-fallback), with `ANTHROPIC_API_KEY` deliberately set in the parent process yet ignored by the agent (proves precedence override).
- **Streaming:** client receives ≥1 `assistant_delta` then `done` with a non-null `cost` for a trivial prompt; `reply.raw` close mid-stream aborts the SDK query (assert `AbortController.signal.aborted`).
- **Guardrails fire:** unit tests prove `maxTurns`/`maxBudgetUsd`/`timeoutMs` each terminate the loop with the right normalized `error` event; `canUseTool` denies an un-allowlisted tool.
- **No built-in tools:** assert the agent has zero filesystem/Bash tools available (`tools:[]`).
- **Build green;** no live Cube needed (echo tool only); live Cube deferred to a Cube-connected host.

## Risk assessment
| Risk | L×I | Mitigation |
|---|---|---|
| SDK silently uses gateway/API key → sonnet-only | M×H | clean spawn env strips API-key vars; smoke asserts model + fails fast if OAuth token absent |
| SDK spawns subprocess → leaks/zombies in long-lived server | M×H | session TTL eviction; AbortController on close; one in-flight turn per session; cleanup on session end |
| `maxBudgetUsd` may only check between turns, not mid-turn (SDK Q) | M×M | belt-and-suspenders wall-clock `timeoutMs` AbortSignal; cap `maxTurns` low for v1 |
| SDK message shapes change across versions | L×M | event-normalizer isolates SDK shapes; pin SDK version |
| Concurrent turns on one session corrupt context | L×H | registry in-flight lock; reject overlapping turn with 409 |

## Backwards compatibility / rollback
- Purely additive: new dir + 2 new routes. No change to existing advisor routes or stores. Rollback = remove the routes + dir + dep; Phases 0–4 unaffected.
- No migration. Sessions are in-memory (ephemeral) — process restart drops sessions; acceptable for v1 (document; durable session store is a v2 follow-up).

## Security
- OAuth token read from env only; never logged, never in audit records, never in SSE payloads.
- `tools:[]` + deny-by-default `canUseTool` = agent cannot touch filesystem/Bash even before Phase 7 wires real tools.
- Inbound redaction + sanitize seams in place (enforced fully in Phase 7).

## Open questions
- Q-A1: `maxBudgetUsd` mid-turn vs between-turn enforcement — empirical test in Phase 9 eval; mitigated by timeout.
- Q-A2: OAuth token rotation (one-year token) — manual refresh for v1; document.

## Next steps
Phase 7 wires the real tool surface + context pack + provenance gate into this harness.
