# Phase 06 — LLM fallback (on-demand, lane-gated, cost-capped)

## Context
- Reuse the advisor/chat LLM path. Caveats (memory + lessons-learned.md:102-106):
  - Gateway key is **sonnet-only** (403 on other models) — memory "LLM gateway key sonnet-only".
  - Anthropic key failover lanes + subscription-auth (OAuth) lane — memory "Anthropic key failover in chat-service", "OAuth token precedence" (lessons-learned.md:102-106): API key out-ranks OAuth unless env scrubbed; force OAuth via `buildAgentEnv()` (`server/src/advisor/agent/agent-oauth-env.ts`).
  - Advisor 240s hard cap precedent (memory "Advisor now works: lens + budget").
- Fires ONLY when P4 matcher returns `bestPlaybook=null` (`needsLlm=true`).

**Priority:** P3. **Status:** pending. **Depends on:** P4 (needsLlm gate) + P5 (panel slot).

## Decision: thin one-shot LLM call, NOT the agent SDK
- This is a single analysis prompt ("here's a slow query shape + verdict + why no playbook matched → suggest an optimization"), not a multi-tool agent loop. Reuse the **chat-service LLM call path** (the simple `callLlm`-style one-shot, same lane logic) rather than spawning the advisor Agent SDK subprocess. KISS/YAGNI: no tools, no streaming, one prompt → one suggestion. Pick the lane via the existing failover helper so we inherit the sonnet-only/OAuth handling.

## LLM call — `server/src/services/query-perf-llm-suggester.ts`
- `suggestViaLlm(verdict, shape): Promise<{ suggestion: string; lane: string } | { error: string }>`:
  - Prompt: NAMES-only shape + P3 verdict (matchability/reason) + measure types from registry. **Never** include filter values/UIDs (none are stored anyway — input is the NAMES-only shape). Ask for a concise remedy + (if structurally possible) a rollup sketch.
  - Model: sonnet (gateway-safe); if forcing OAuth lane, scrub env per `buildAgentEnv()` precedent — do NOT mutate long-lived `process.env`.
  - **Hard timeout** (default 60s, env-overridable; well under advisor's 240s — this is one short call). Abort on timeout → return `{error:'llm_timeout'}`.
  - **On-demand only:** triggered by admin clicking "Generate suggestion" in the P5 panel — NEVER auto-run per captured query (cost + the gateway-key drain failure mode, lessons-learned.md:104).
  - Cost guard: rate-limit per-admin (simple in-memory token-bucket, e.g. N/min) so a click-spam can't drain the lane; cache the suggestion per `query_perf.id` (so re-opening the panel doesn't re-call). Cache in memory or a small column on the row — KISS: in-memory LRU keyed by id.
- Lane selection: reuse the chat-service auth-mode helper / failover order (primary→stg→backup→subscription OAuth). Report which lane answered (`lane` field) for the audit-conscious admin (mirrors advisor audit fields, memory "Advisor run audit console").

## Read API
- Extend `query-perf.ts`: `POST /api/query-perf/:id/llm-suggest` — admin-gated; runs `suggestViaLlm` only if `needsLlm` for that row's verdict (else 409 "playbook available — LLM not needed"). Returns suggestion + lane, or a graceful error (timeout/lane-exhausted) the UI shows as "LLM unavailable, try later" (do NOT 500).

## UI
- P5 panel's LLM affordance: when `needsLlm`, enable "Generate suggestion" button → POST → render the returned text in the suggestion section (markdown-safe plain text). Show lane + a "regenerate" (re-call) control. On error, inline non-blocking notice.

## Related files
- Create: `server/src/services/query-perf-llm-suggester.ts`, `query-perf-llm-suggester.test.ts` (mock the LLM call — assert prompt has NAMES only, timeout aborts, gate rejects when playbook exists).
- Modify: `server/src/routes/query-perf.ts` (`POST /:id/llm-suggest`), `query-perf-optimize-panel.tsx` (LLM affordance), `query-perf-data.ts` (llm-suggest mutation hook).

## Todo
- [ ] query-perf-llm-suggester.ts (prompt builder NAMES-only, lane select reuse, hard timeout, per-id cache, per-admin rate-limit)
- [ ] POST /:id/llm-suggest (gate on needsLlm; graceful error)
- [ ] panel LLM affordance + mutation hook
- [ ] tests: prompt contains no values; timeout→error not throw; gate rejects when bestPlaybook!=null; cache prevents 2nd call

## Success criteria
- Clicking "Generate suggestion" on a no-playbook query returns a remedy within the timeout; lane reported.
- LLM NEVER auto-runs on capture (verified: no call path from P1/P2).
- A query WITH a matching playbook → endpoint refuses (409) — LLM reserved for the genuine gap.
- Prompt provably contains only member NAMES + verdict (test).
- Lane/timeout/cost guards in place; gateway-key-drain failure mode (lessons-learned.md:104) avoided by on-demand + rate-limit + cache.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Auto-running LLM drains shared gateway key | L×H | On-demand only (admin click); per-id cache; per-admin rate-limit; gate on needsLlm. The documented drain failure mode. |
| Wrong auth lane (API key out-ranks OAuth) | M×M | Reuse buildAgentEnv()/failover helper; never mutate process.env; test lane selection. |
| Non-sonnet model 403 | M×M | Pin sonnet (gateway-safe); failover helper handles lane exhaustion gracefully. |
| LLM hallucinates an invalid rollup | M×M | Output is advisory text in a DRAFT context; admin reviews; structural drafts still come from P5's pure scaffolder, not the LLM. |

## Security
Admin-gated POST. Prompt carries NAMES-only shape (no PII — none is stored). No secrets in prompt. Lane creds handled by existing scrubbed-env helper.

## Open questions
1. Persist LLM suggestions to a table (audit, like advisor-run-audit migration 055/056) or keep in-memory cache only? Plan: in-memory v1 (KISS); add a `query_perf_llm_suggestion` table later if audit is required. **Confirm with user** whether LLM-suggestion audit persistence is needed for compliance.
2. Per-admin rate-limit value (N/min) — pick a conservative default (e.g. 5/min), confirm with user.
3. Reuse chat-service one-shot `callLlm` vs a gateway call from the gateway server directly — verify which path is cleanest at implementation (chat-service already has the lane/failover logic; gateway may need to proxy). Scout at P6 start.
