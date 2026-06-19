# Chat-driven Segment Creation (incl. measure / top-N / percentile)

## Goal
Add a second chat-service flow: detect "create a segment" intent and propose+create a
segment from chat — straight in chat, after a chat exploration, or from `/build`.
Cover the 3 non-trivial intents that today cannot become a predicate segment:
measure threshold (`revenue > 1000`), top-N (`top 100 spenders`), percentile (`top 25%`).

## Core architecture
- **chat proposes, FE writes.** chat-service stays read-mostly: it emits a
  `segment_proposal` (draft predicate + resolved cutoff + est. size); the FE confirm
  card POSTs `/api/segments` (reuses the existing create endpoint + refresh job).
- **All 3 hard cases reduce to one op:** resolve a measure to a per-user *cutoff value*,
  emit a plain `gte`/`lte` dimension leaf. The cutoff engine already exists
  (`percentile-cutoff-resolver.ts`, Trino `approx_percentile`) — it is wired to Care, not
  segments. The work is connecting it + giving chat the metadata to drive it.
- **top-N → percentile** at propose time (`p = 1 − N/|population|`); reuses the percentile
  engine, no separate rank resolver.

## Locked decisions
- top-N default = **rolling** predicate (count drifts; not frozen).
- percentile cutoff = **rolling**, re-resolved every refresh (tracks live distribution).
- two-pass = **one stage inside the existing 60s refresh budget** — measured overhead
  ≤0.7s (raw column) / ≤4.7s (jus dual-identity merge). See research report.
- **INVARIANT:** spend percentile/top-N MUST be population-scoped (default = payers,
  `ltv>0`). Unscoped p75 = 0 → selects everyone (verified on cfm_vn 7.2M / jus_vn 1.9M).

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 1 | [Server: rolling cutoff two-pass + preview endpoint](phase-01-server-rolling-cutoff-two-pass.md) | done (incl. jus identity-merge wrapper) | — |
| 2 | [Measure→dimension catalog (window-annotated)](phase-02-measure-dimension-catalog.md) | done (cfm_vn + jus_vn blessed) | — |
| 3 | [chat-service: translator + guardrails + propose_segment tool](phase-03-chat-service-propose-segment.md) | done (threshold / percentile / top-N / explored-query kinds) | 1, 2 |
| 4 | [Frontend: segment proposal confirm card](phase-04-frontend-segment-proposal-card.md) | done | 3 |
| 5 | [Tests, docs, lessons-learned](phase-05-tests-docs-lessons.md) | done — unit tests per phase; docs + lessons + memory updated | 1–4 |

<!-- Status: P1–P5 shipped. Commit 01832349 (P1–P4 + review fixes S1/S2). Follow-up commit:
P5 docs/lessons, propose-segment split into 4 modules, and segment_proposal reload-persistence
(proposals_json mirrors charts_json end-to-end). Live-verified vs Trino: cfm_vn top-25%
~757k₫/~58,451; jus_vn ~6.9M₫/~10,251 (merge path). Remaining: full conversational e2e was
exercised manually by the user (proposal renders + persists); server DB-route tests still blocked
locally by a pre-existing better-sqlite3 NODE_MODULE_VERSION mismatch (rebuild to run them). -->


## Key references
- Research: `plans/reports/` (this session) — percentile timing + correctness finding.
- Cutoff engine: `server/src/services/percentile-cutoff-resolver.ts`.
- Translate gate: `server/src/services/translator.ts` (`PercentileNotResolvedError`).
- Create/refresh: `server/src/routes/segments.ts`, `server/src/jobs/refresh-segment.ts`.
- Predicate model: `server/src/types/predicate-tree.ts` (`PercentileValue {p, over}`).
- chat tool surface: `chat-service/src/tools/registry.ts`, `emit-query-artifact.ts`.

## Shippable increments
- After P1+P2: measure-threshold + percentile segments creatable via API (no chat UI).
- After P3: chat can propose all 3 (no confirm card yet — proposal in SSE).
- After P4: full end-to-end from chat.
