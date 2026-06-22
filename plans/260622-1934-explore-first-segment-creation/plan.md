# Explore-first segment creation

Turn chat exploration into the on-ramp for segments. Let users play in the data, then crystallize a cohort — with lineage, a visual cutoff, a pre-save profile, and a novelty guard.

See `brainstorm.md` for the LiveOps framing, scouted facts, and deferred alternatives.

## The four moves
1. **Build-segment-from-exploration bridge** (+ lineage) — explored query → predicate proposal.
2. **Distribution-first cutoff picker** — see the curve, drag the knife, live count.
3. **Pre-save cohort profile** — "who are these people?" before saving.
4. **Overlap / novelty guard** — flag near-duplicate segments at propose-time.

## External dependency
`plans/260622-1833-segment-size-multimeasure-edit` phase-01 builds the dry-run count endpoint. Phases 03–05 here reuse it for the live size readout. If that lands first, those phases use it directly; if not, Phase 03 carries a minimal count fallback via `/api/preview`.

## Status: IMPLEMENTED (2026-06-23)
All six phases shipped + verified. Server build clean; chat-service 1372/1372; 73 new tests pass; FE touched files typecheck clean. Code-reviewed APPROVE_WITH_NITS — the one Medium (overlap `owner` body-override cross-user leak) fixed. Key reuse vs original plan: the CubeQuery→predicate translator + segmentability gate ALREADY existed in chat-service (`cubeQueryToPredicateTree` + `propose_segment kind=query`), so Phase 01 became (a) a server mirror of that translator behind `/api/segments/translate-query` and (b) net-new lineage (`source_query` → `born_from`).

## Phases
| # | Phase | Service | Move | Status |
|---|-------|---------|------|--------|
| 01 | Query→predicate translation + proposal lineage | server + chat-service + types | 1 (foundation) | done |
| 02 | "Build segment from this" bridge on artifact/chart cards | src (FE) | 1 | done |
| 03 | Distribution endpoint (`POST /api/distribution`) | server | 2 | done |
| 04 | Distribution-first cutoff picker UI | src (FE) | 2 | done |
| 05 | Pre-save cohort profile endpoint + panel | server + src | 3 | done |
| 06 | Overlap / novelty guard | server + src | 4 | done |
| 07 | Docs + lessons-learned | docs | — | done |

## Dependencies
- 02 needs 01. 04 needs 03. 05 independent server-side, FE after 02. 06 last (most approximate). 07 after the rest.
- Each move (1/2/3/4) is independently shippable — no big-bang.

## Key risks
- **Segmentability gate** (move 1): aggregate-only / multi-cube / time-series queries aren't segmentable — hide the bridge rather than emit a broken predicate.
- **Query latency** (moves 2/3): distribution + profile must hit the per-user pre-agg grain, timeout-bounded, with graceful fallback (plain numeric input / count-only).
- **Approximate overlap** (move 4): candidate has no membership snapshot — sample-vs-snapshot intersection is approximate; label "~", scope to same game.

## Open questions (carried from brainstorm)
1. Saveable "exploration" as its own object, or segment-only durable primitive?
2. Distribution buckets: deciles (default) vs adaptive?
3. Overlap scope: own segments only, or workspace-shared too?
4. Approximate overlap acceptable, or materialize candidate first?
