# Agent intelligence rework — model-aware, memory-aware, ask-frugal

## Goal
Make the chat agent reason from the game's actual data model and the session's
already-resolved context, so it answers with sensible defaults instead of asking
obvious questions. Enforce the smart behavior with deterministic code gates, not
just prompt guidance.

## Problem (verified in code, 2026-06-17)
1. **No model awareness.** Agent learns the schema by glossary term-matching +
   on-demand `get_cube_meta` (joins only under `scope=full`, which degrades to a
   name index on big games). No join graph / hub map is injected. It cannot
   triage "which cube holds this metric, what can it join to".
   A full deterministic join-graph builder already exists but only runs in the
   FE Catalog (`src/pages/Catalog/cube-graph/build-join-graph.ts`).
2. **No identity/context continuity on the agent path.** Slot memory persists
   entity/metric/timeRange and only flips on rephrase (`disambiguate-memory-merge.ts`
   `blockTopicFill`), but the free-form agent (`offer_choices`) bypasses it — so it
   re-asks the entity even after "top VIP **players**" already pinned it.
3. **Over-asking / wrong-grain choices.** Asks metric/time/entity when an obvious
   default exists; offered ARPU/ARPDAU to rank individuals (partially fixed via
   guidance — see `plans/260617-…` work). No "default + state + correct" policy.
4. **The disambiguation-mode toggle is inert for agent turns.** `targeted`/
   `aggressive` only drives the deterministic `modeGate` (`mode-gate.ts`); the agent
   prompt never sees it (`turn.ts:404` → `disambiguate-query.ts:106` only). The
   user-facing toggle doesn't change the behavior users actually experience.

## Locked decisions (user, 2026-06-17)
- **Scope:** full agent-intelligence rework (model + memory + asking + engine routing + eval).
- **Asking posture:** default + state-assumption + offer one-click correction; block-ask only for high-impact ambiguity.
- **Enforcement:** deterministic code gates where possible; guidance as backstop.
- **Q-A — digest timing:** inject the model digest EVERY turn (prompt-cached → ~0 marginal cost per game; survives compaction).
- **Q-B — toggle:** KEEP + relabel "Aggressive/Targeted" to its real effect, wire it to agent posture (P04), default = **Aggressive** (auto-answer with assumptions).
- **Q-C — metric default:** the game's Revenue measure resolved via the glossary concept (handles per-game member differences, e.g. `revenue_vnd_real`); `mustAsk` fallback if no revenue measure exists.

## Phases
| # | Phase | Surface | Status |
|---|-------|---------|--------|
| 0 | [Foundations + contracts](phase-00-foundations-and-contracts.md) | shared types | ✅ done (2026-06-17) |
| 1 | [Server-side model-graph digest + injection](phase-01-model-graph-digest.md) | BE | ✅ done (2026-06-17) |
| 2 | [Resolved-context injection + continuity enforcement](phase-02-resolved-context-injection.md) | BE | ✅ done (2026-06-17) |
| 3 | [Smart-default / ask-frugal policy](phase-03-smart-default-policy.md) | BE | ✅ done (2026-06-17) |
| 4 | [Make the disambiguation toggle govern the agent](phase-04-disambiguation-toggle-rework.md) | FE+BE | ✅ done (2026-06-17) |
| 5 | [Route resolution through the deterministic engine](phase-05-engine-routing-grain-gate.md) | BE | ✅ done (2026-06-17) |
| 6 | [Eval + live verification harness](phase-06-eval-and-verification.md) | BE/test | ✅ deterministic done; live N-run smoke deferred (manual, OAuth+Cube lane) |
| 7 | [Docs + staged rollout](phase-07-docs-and-rollout.md) | docs | ✅ done (2026-06-17) |

## Sequencing
- P0 → P1, P2 (independent, can parallelize) → P3 (depends on P1+P2 data) →
  P4 (depends on P3 posture) → P5 (deepest; depends on P3 grain rules) →
  P6 (gates the whole thing) → P7.
- Each phase ships behind a flag and is independently revertible.

## Key dependencies / reuse (no new wheels)
- `build-join-graph.ts` (FE, pure TS) → extract to a shared module both FE + BE import.
- `cube-meta-cache.ts` (BE) → source of /meta for the digest; reuse its invalidation.
- `disambiguate-memory-merge.ts` → slot memory + `blockTopicFill` rephrase gate (reuse, don't rebuild).
- `mode-gate.ts` → extend to also expose posture to the agent prompt.
- `offer_choices` / `disambig_options` SSE → reuse for the "change it" correction chips.

## Success criteria (measured in P6)
- ↓ avg clarifying turns before first real answer on a fixed prompt corpus.
- 0 wrong-grain ranking suggestions (ARPU for individuals).
- Locked entity/metric/time never re-asked within a session unless rephrased.
- The toggle measurably changes agent asking behavior (or is retired).
- No regression: full chat-service suite + FE chat tests green.

## Open questions (for user)
- None — Q-A/B/C settled above (2026-06-17). New questions surface inside phases during implementation.
