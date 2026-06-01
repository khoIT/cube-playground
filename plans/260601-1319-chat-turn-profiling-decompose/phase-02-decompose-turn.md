# Phase 02 — Decompose turn.ts → 5 modules

**Priority:** P0 (the main deliverable). **Status:** pending (start after phase 1 baseline).

## Goal

Split the 911-LOC `turn.ts` handler into focused, independently testable modules without changing behaviour. Behaviour-preserving refactor — all 869 chat-service tests stay green throughout.

## Target module boundaries

Extract from `chat-service/src/api/turn.ts` (keep the route shell thin — header parsing, SSE hijack, orchestration only):

| New module | Responsibility | Source lines (approx) |
|---|---|---|
| `turn/session-controller.ts` | session acquire/create + mutex (`tryAcquire`, 409 path), compaction trigger | ~140–245 |
| `turn/response-cache-gateway.ts` | meta-hash + cache-key compute + lookup + `replayCachedTurn` + cache-hit persist | ~344–425 |
| `turn/prompt-builder.ts` | intent/skill resolve, `getFocus`, `compose()`, web-search/research flag resolution | ~290–342 |
| `turn/llm-runner-wrapper.ts` | observer construction, `claudeRunner.run` loop, event accumulation + emit | ~497–648 |
| `turn/assistant-turn-writer.ts` | post-loop persist (`appendTurn`, `incrementTurnCount`, title summariser) | ~650–806 |

Route handler retains: header/body parse, SSE setup, timer, abort/timeout wiring, and the call sequence across the five modules.

## Constraints

- **Behaviour-preserving only.** No logic changes; perf changes are phase 3.
- Preserve the `turn-timing` marks at the same boundaries (they move with the code).
- Keep the stream-registry / `emit` closure semantics identical (ring-buffer replay must still work).
- Each extracted module < 200 LOC; if `llm-runner-wrapper` can't fit, split the inner SDK-resume branch (`~756–800`) into `turn/sdk-resume.ts`.
- No code comments referencing phase numbers / finding codes (project rule).

## Steps

1. Extract pure/leaf pieces first (`prompt-builder`, `assistant-turn-writer`) — lowest coupling.
2. Extract `response-cache-gateway` (self-contained early-return path).
3. Extract `session-controller` (mutex + lifecycle).
4. Extract `llm-runner-wrapper` last (most entangled with `emit`/registry/observer).
5. After each extraction: `npx tsc --noEmit && npx vitest run` (must stay 869 green).

## Success criteria

- `turn.ts` < ~200 LOC; each new module < 200 LOC.
- 869 chat-service tests green after every step (not just at the end).
- No behavioural diff (cache hit/miss, abort, timeout, compaction, title-summary all unchanged).
- `code-review` agent pass on the diff.

## Risk

- `emit`/registry closure capture is the trickiest seam — extracting `llm-runner-wrapper` may need an explicit `emit`+`registry`+`timer` params object. Mitigate by doing it last and leaning on the test suite.
- Hidden ordering dependency (e.g. timeout armed after compose). Preserve call order exactly.

## Open questions

- New files under `src/api/turn/` (route-local) vs `src/services/turn/`? Proposal: `src/api/turn/` since they're handler-internal. Confirm before extracting.
</content>
