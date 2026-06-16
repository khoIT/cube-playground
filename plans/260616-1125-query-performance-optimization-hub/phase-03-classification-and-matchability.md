# Phase 03 — Pre-agg-hit classification + rollup-matchability

## Context
- Model registry loader: `server/src/services/preagg-model-registry.ts:40-127` (parses `pre_aggregations` from YAML — gives, per cube, the rollup measures/dims/time_dimension).
- CRITICAL caveat (lessons-learned.md:61,69-73): lambda rollups (`union_with_source_data: true`) return EMPTY `usedPreAggregations[]` even when sealed partitions serve. `usedPreAggregations` is a HINT not proof. Routing proof = compiled SQL FROM clause. Additive-only rollups (count/sum/min/max/count_distinct_approx); avg/exact count_distinct are non-additive (70-72). Time-dim must match exactly (57-61).

**Priority:** P2. **Status:** pending. **Depends on:** P1 (captured `used_preaggs` + `query_shape` + `latency_ms`).

## What this phase produces
A **pure classifier** that, given a captured `query_perf` row + the model registry, returns:
- `preaggHit: 'hit' | 'miss' | 'unknown'` (backfills the P1 `preagg_hit` column).
- `matchability: 'matchable' | 'unmatchable' | 'partial'` — can this query shape EVER be served by a rollup? (drives P4/P5: a per-user row-listing is `unmatchable` → no rollup will help → playbook = materialize-snapshot / accept-timeout, not add-rollup).
- `reason: string` — short human label ("per-user dimension → no aggregate rollup possible", "time dim mismatch: query=dteventtime, rollups keyed on log_date", "additive-safe + rollup exists → should hit").

## Classification logic (combine signals — no single proof)
`preaggHit`:
1. If `used_preaggs` non-empty → `hit`.
2. Else if shape is `unmatchable` (below) → `miss` (definitely raw — no rollup could serve).
3. Else if a matching rollup EXISTS in registry AND latency is in the fast band (< SLOW_MS) → `unknown` (likely lambda hit — empty array is expected; cannot prove without compiled SQL). Label reason "lambda-ambiguous".
4. Else (matchable, rollup exists, but slow) → `miss` (fell through despite a candidate — the actionable case).
5. Else (matchable, NO rollup exists) → `miss`, reason "no rollup defined".

`matchability` — pure function of `query_shape` vs registry:
- **unmatchable** if dimensions include a high-cardinality per-entity identifier (e.g. `*.user_id`, `*.role_id`, `*.transaction_id`) → it's a row-listing, no aggregate rollup applies. This is the verified root-cause class (the `mf_users.user_id`+date query).
- **matchable** if every measure is additive (registry/type check) AND dimensions are low-cardinality grouping dims AND a time grain is present (or addable).
- **partial** if measures include a non-additive (`avg`/exact `count_distinct`) — remodellable but not as-is (lessons-learned.md:70-72).
- Time-dim check: if a candidate rollup exists but its `time_dimension` ≠ the query's bound time dim → flag `matchable` with reason "time-dim mismatch (add *_ts_batch sibling)" (the documented cfm dteventtime/log_date trap, 57-61).

## Identifier-dimension heuristic
- Maintain a small config set of identifier suffixes/members: `user_id`, `role_id`, `account_id`, `transaction_id`, `transid`, `vng_transaction`, `openid`, `vopenid`. Member is an identifier if its `.member` matches. Keep as a tunable constant (not hardcoded inline) — `IDENTITY_DIMENSIONS`. (Mirrors the identity-dim concept used in segment scoping; do NOT import segment code — keep this module self-contained, KISS.)

## Implementation
- New pure module `server/src/services/query-perf-classifier.ts` (<200 lines): `classifyQueryPerf(shape, usedPreaggs, latencyMs, registryView): { preaggHit, matchability, reason }`. No I/O — takes a registry view built by the caller from `preagg-model-registry.ts`.
- Backfill: a light read-time enrichment in the P2 read routes — call `classifyQueryPerf` per row when serving `/failures` and `/recent`, OR a small batch updater that sets `preagg_hit` after capture. **Recommend read-time** (KISS, registry may change, capture stays cheap) — classifier is pure + fast. Store `preagg_hit` only if a later phase needs SQL aggregation on it; for now compute on read.
- Registry view: load once per request via existing loader, memoized (registry is process-stable; reuse any existing cache in preagg-model-registry).

## Related files
- Create: `server/src/services/query-perf-classifier.ts`, `query-perf-classifier.test.ts`.
- Modify: `server/src/routes/query-perf.ts` (enrich rows with classifier output), `query-perf-row.tsx` (render hit/miss/unknown + matchability badge + reason tooltip).

## Todo
- [ ] IDENTITY_DIMENSIONS constant + isIdentifierDim()
- [ ] matchability(shape, registryView) pure fn (unmatchable/matchable/partial + time-dim mismatch)
- [ ] preaggHit(shape, usedPreaggs, latency, registryView) combining signals
- [ ] registry view builder from preagg-model-registry
- [ ] wire into read routes (read-time enrichment)
- [ ] UI badges + reason tooltip
- [ ] unit tests: per-user row-listing → unmatchable+miss; additive+rollup+fast → hit/lambda-unknown; non-additive → partial; time-dim mismatch → matchable+reason

## Success criteria
- The verified root-cause query (`mf_users.user_id` + date + `ltv_30d_vnd` filter) classifies `matchability:unmatchable`, `preaggHit:miss`, reason naming the per-user dimension.
- A known additive rollup-backed query (e.g. `active_daily.dau` by `log_date`) classifies `hit` (or `lambda-unknown` if lambda) — NOT a false `miss`.
- Classifier is pure (no DB/network) — tested with fixtures + a real registry excerpt.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Lambda empty-array → false "miss" | H×M | Tri-state `unknown`/"lambda-ambiguous" instead of asserting miss; reason explains. Don't over-claim — matches lessons-learned guidance. |
| Identifier heuristic misses a game's id col | M×M | Tunable IDENTITY_DIMENSIONS set; default conservative; reason text shows the dim so admin can judge. |
| Registry drift vs live /meta | M×L | Read-time classify uses current registry; reason is advisory not authoritative (admin reviews before P5 scaffolds). |

## Security
Pure logic; no new endpoints. Operates on NAMES-only shape — no PII.

## Open questions
1. Worth fetching compiled SQL (`/cube-api/v1/sql`) on-demand for a single flagged query to turn `lambda-unknown` into proof? Defer — adds an upstream call; the tri-state is honest enough for triage. Revisit if admins find `unknown` noisy.
