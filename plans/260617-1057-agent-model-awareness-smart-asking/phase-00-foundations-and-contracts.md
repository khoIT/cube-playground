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
- [x] Make builder framework-free; vendor byte-identical twin into chat-service; FE untouched, FE cube-graph tests green (33/33)
- [x] Add `ModelGraphDigest` + `ResolvedContext` types (`chat-service/src/core/agent-context-types.ts`)
- [x] Add 5 feature flags (default off) + env wiring (`config.ts`)
- [x] `tsc --noEmit` clean both packages (chat-service exit 0; FE only pre-existing unrelated errors)

## Success criteria
- Both packages typecheck; FE cube-graph renders identically; all flags off = no behavior change. ✅

## Done (2026-06-17) — architecture deviation from the plan default
The plan's default home (`shared/cube-model-graph/` at repo root, imported by BOTH
packages) is **infeasible** given the verified build topology and was NOT used:
- chat-service `tsconfig.json` has `rootDir: src` + `tsc` emit → a top-level
  `shared/` import fails TS6059 ("not under rootDir").
- the root `Dockerfile` builds chat-service in a stage that copies only
  `chat-service/` and ships a runtime image with **no FE `src/`** — so a single
  cross-package import would break the standalone build.
**Chosen instead:** the FE builder was made framework-free (removed its only FE
import, `CatalogCube`; added a self-contained `JoinGraphInputCube` and widened the
`buildJoinGraph` param — FE callers unaffected by structural typing), and a
**byte-identical twin** lives at `chat-service/src/shared/cube-model-graph/`. A
deterministic **drift-guard test** (`chat-service/test/cube-model-graph-drift.test.ts`)
fails if the two copies diverge — the "no drift" enforcement the plan asked for,
delivered without a cross-package import. FE import sites were left 100% unchanged
(lowest regression risk).

## Risks (closed)
- Moving the builder would break FE import paths → AVOIDED: FE file kept in place,
  only its input type was widened; no FE import re-pointing needed.

## Open questions
- RESOLVED: shared-module home = byte-identical vendored copy + drift guard (the
  `shared/` default was infeasible per build topology above; npm-workspace pkg was
  heavier than warranted). New module reuse should follow the same vendor+guard
  pattern until/unless a workspace package is justified.
