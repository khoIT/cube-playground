# Phase 00 — Foundations & contracts

## Overview
Priority: P0 (blocks all). Status: ☐. Establish the shared types and the
flag plumbing every later phase depends on, with zero behavior change.

## Key insights
- The work spans FE (`src/`) and BE (`chat-service/`). The one pure asset to
  share is the join-graph builder; everything else is BE-local.
- Each phase must be independently revertible behind a flag — agent-behavior
  changes are guidance/data driven and hard to unit-prove, so a kill switch
  per capability is mandatory.

## Requirements
- Functional: a typed `ModelGraphDigest` contract; a typed `ResolvedContext`
  contract; per-capability feature flags in `config.ts`.
- Non-functional: no runtime behavior change when all flags off (default off).

## Architecture
- Extract `build-join-graph.ts` from `src/pages/Catalog/cube-graph/` into a
  framework-free shared module (no React import already — confirm) so both FE
  and BE import the SAME builder. Candidate: `shared/cube-model-graph/`.
- New BE types in `chat-service/src/core/agent-context-types.ts`:
  - `ModelGraphDigest` (hub cube+pk, clusters, edges[N:1], isolated[]).
  - `ResolvedContext` (locked entity/metric/timeRange/concept/intent + lockedAtTurn).
- Flags in `chat-service/src/config.ts` (all default false):
  `agentModelDigestEnabled`, `agentResolvedContextEnabled`,
  `agentSmartDefaultsEnabled`, `agentModeGovernsPosture`, `agentEngineRouting`.

## Related code files
- Read: `src/pages/Catalog/cube-graph/build-join-graph.ts`, `chat-service/src/config.ts`,
  `chat-service/src/core/mode-prompts.ts`, `chat-service/src/nl-to-query/types.ts`.
- Create: `shared/cube-model-graph/build-join-graph.ts` (moved), `…/index.ts`;
  `chat-service/src/core/agent-context-types.ts`.
- Modify: FE imports of build-join-graph → point at shared module; `config.ts` flags.

## Implementation steps
1. Verify `build-join-graph.ts` has no FE-only imports; move to `shared/cube-model-graph/`.
2. Re-point FE Catalog imports; run FE build + cube-graph tests (must stay green).
3. Add the two type files; add 5 flags to config with env wiring + defaults false.
4. No injection yet — just the contracts compile and are imported nowhere behavioral.

## Todo
- [ ] Move builder to shared, re-point FE, FE tests green
- [ ] Add `ModelGraphDigest` + `ResolvedContext` types
- [ ] Add 5 feature flags (default off) + env wiring
- [ ] `tsc --noEmit` clean both packages

## Success criteria
- Both packages typecheck; FE cube-graph renders identically; all flags off = no behavior change.

## Risks
- Moving the builder breaks FE import paths → mitigate with a barrel re-export + run FE tests.

## Open questions
- Final home for the shared module (`shared/` vs a small npm-workspace pkg)? Default: `shared/cube-model-graph/`.
