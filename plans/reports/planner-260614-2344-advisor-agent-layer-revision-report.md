# Optimization Advisor — agent-layer plan revision

**Plan dir:** `plans/260614-1813-optimization-advisor/` · **Date:** 2026-06-14 · **Status:** DONE

## What changed
Revised the existing Optimization Advisor plan to add a full in-process AI-agent orchestration layer on top of the BUILT deterministic engines (Phases 0–4). Planning only — no implementation code written.

### plan.md (revised)
- Title/description reframed: "in-process AI experiment agent."
- Architecture diagram rewritten: agent (Agent SDK, OAuth lane) on top of the deterministic tool layer + Cube/Segments read tools; added the HYBRID provenance-gate description.
- Principles updated (agent orchestrates, doesn't fork engines; numbers authority = deterministic tools).
- Phases table extended with 6–9; Phases 0–4 reframed as "the deterministic tool layer the agent orchestrates"; Phase 5 marked superseded→folded into 9.
- New "Locked decisions — agent layer" block captures the 3 user decisions verbatim.
- Effort bumped ~9d → ~16d.

### New phase files (continue numbering)
- `phase-06-agent-runtime-foundation.md` — in-process Agent SDK harness (`server/src/advisor/agent/`), OAuth-token auth (strip API-key env so OAuth wins SDK precedence), streaming-input multi-turn session, SSE bridge mirroring `routes/chat.ts`, cost/turn/timeout guardrails, deny-by-default tools, inbound redaction+sanitize seams, audit log. Echo tool only — no real tools yet.
- `phase-07-agent-tool-surface-context.md` — wrap BUILT engines (diagnose/recommend/mapLevers/checkPower/expectedIncremental/listPriors/scaffoldDraft) + cubeQuery/cubeMeta + segmentMembers/predicateCompile as typed `createSdkMcpServer` tools; the omniscient context pack (inject vs retrieve); the HYBRID provenance ledger+digest gate; the redaction guard.
- `phase-08-interactive-drive-ui.md` — swap the `simulateInvestigation` stub in `useAdvisorInvestigation` for the agent SSE stream; reducer maps runtime events → stage fills; exploratory/validated number badges; steering→follow-up turns; validated-only hand-off; design-token compliant (antd v4).
- `phase-09-guardrails-eval-tests-docs.md` — hybrid-gate/glass-box/no-PII/runaway/injection tests, experiment-QUALITY eval harness (powered+feasible+₫-material+provenanced+goal-fit scorecard), live OAuth smoke (this host) + host-gated live Cube, carried-forward Phase-5 deterministic tests, docs.

### Original phase-05
Annotated SUPERSEDED → folded into Phase 9; retained for the deterministic-layer test specs.

## Verification (re-grepped this session, not from scout summary)
- Seams confirmed: `CubeReaderFn` cube-read.ts:36; `LlmCallerFn=(prompt)=>Promise<string>` llm-phrasing.ts:34; `WorkspaceCtx` cube-client.ts:19; `loadWithCtx`/`getMetaWithCtx` cube-client.ts:153/137.
- Engines confirmed: `diagnose` diagnosis-engine.ts:56; `rankCandidates` candidate-ranker.ts:6; `mapLevers` lever-map.ts:239; `checkPower` power-check.ts:127; `expectedIncremental` money-model.ts:47; `getPrior`/`listPriors` treatment-effect-library.ts:55/85; `scaffoldDraft` handoff-scaffolder.ts:110; `recommend` recommend.ts:81.
- Routes are Fastify (`app.post`, advisor.ts:79); SSE pattern uses `reply.raw.writeHead(200,{'Content-Type':'text/event-stream'})` + `reply.raw.on('close')` (chat.ts:248-256).
- Auth-lane: `LlmAuthMode='auto'|'gateway'|'subscription'` chat-llm-auth-client.ts:12.
- Frontend: `useAdvisorInvestigation()` use-advisor-investigation.ts:94 currently calls `simulateInvestigation` — the documented swap point. `STAGES` (opportunity/target/cause/lever/proof) advisor-stage-config.ts:10.
- Migration 054 (STUB draft+feedback store) present — the registry swap-point.

## SDK research (researcher sub-agent, cited)
`@anthropic-ai/claude-agent-sdk` v0.3.170+; `query()` entry; reads `CLAUDE_CODE_OAUTH_TOKEN` (but `ANTHROPIC_API_KEY` outranks it — runtime must strip it); OAuth lane unlocks full model + agentic loop; in-process tools via `tool()`+`createSdkMcpServer`; streaming async-iterator (assistant/tool_progress/result); multi-turn via streaming-input async-iterator; guardrails `maxTurns`/`maxBudgetUsd`/`permissionMode`/`canUseTool`/`tools:[]`/AbortSignal. SDK spawns a bundled subprocess for the LLM call but our tools run in-process.

## Behavioral-checklist self-audit
Data flows, dependency graph (6→7→8, 9 depends 6/7/8), per-phase risk tables, backwards-compat/rollback, test matrix, file ownership (each phase owns distinct files; engines untouched), measurable success criteria — all present in each phase file.

## Unresolved questions
1. **`maxBudgetUsd` enforcement** — mid-turn vs between-turn? Mitigated by wall-clock timeout; empirical confirmation in Phase 9 (Q-A1).
2. **OAuth token rotation** — one-year token, no documented auto-refresh; manual for v1 (Q-A2).
3. **Context-pack split** — injected (trimmed) vs retrieval for the data-model summary; start injected, move if token budget bites (Q-A3).
4. **Experiment-quality threshold** — calibrate on fixed scenarios; revisit once real outcomes feed the Library (Q-A7).
5. **Agent auto-start vs explicit Drive** — defaulted to explicit Drive button (Explore-first); confirm with user (Q-A5).
6. Carried from product doc: peer-matching def (#1), actuator roadmap (#2), engagement-measure availability per-segment (#3), ₫-per-unit factors (#4), lens compute/cache (#5).
