# Phase 01 — cfm_vn spike: build the fix, measure build + serve

**Priority:** P0. **Status:** blocked by phase-00. **Scope:** cfm_vn only (prove before spread).
**Goal:** implement the phase-00-recommended fix on cfm_vn, prove the target query classes
flip to `external:true`, and bound the build cost.

## Inputs (LOCKED by user 19 Jun)

- **D1 — counts = APPROX.** Segment-sizing rollup uses `user_count_approx` (HLL). No exact
  `user_count` in the rollup; exact pulls use the identity projection.
- **D2 — P1 = ALL THREE (A+B+C).** A `originalSql` pre-agg materialising the snapshot · B fix
  join-root so member queries read snapshot not `etl_ingame_moneyflow` · C raise missing
  fields upstream (per-game flag where absent; don't fake).

## Work — P2 (segment-sizing rollup, low effort, do first)

1. Add to `cube-dev/cube/model/cubes/cfm/mf_users.yml` a `*_batch` rollup +
   `rollup_lambda` (fresh tail), following [[cube-rollup-authoring-rules]]:
   - measures: `ltv_total_vnd` (sum, additive), `paying_users_*`, `user_count_approx` (D1=approx).
   - dimensions: `churn_risk, engagement_segment, payer_tier, lifecycle_stage, is_paying_user`
     (the segment-defining dims; add `country` if cheap).
   - time_dimension: pick the dim the queries actually filter (likely none → use a stable
     snapshot date col, NOT `install_date`; verify against compiled SQL, not assumptions —
     time-dim mismatch is the #1 rollup-miss trap, [[cube-rollup-authoring-rules]]).
   - additive-only in `aggregationsColumns`; bound `build_range_end` to real data extent
     (future-seal trap, [[cube-preagg-build-mechanics-harness]]).
2. Reload dev cube (DEV_MODE reload mechanics, [[advisor-now-works-lens-and-budget]]);
   rebuild the rollup.

## Work — P1 (member-detail, higher value) — do BOTH A and B

3. **B (join-root fix):** repoint the member projection at the snapshot path so the compiled
   SQL no longer roots in / joins `etl_ingame_moneyflow` (per phase-00 root-cause). This alone
   should kill the raw-moneyflow scan for member-detail.
4. **A (originalSql):** add an `originalSql` pre-agg materialising the mf_users snapshot in
   CubeStore so member-detail + rollups both build on the cached snapshot, not the live
   derived view. Keeps member queries fast even when B can't fully remove the join.
5. **C (upstream):** where a field member queries need is absent from the snapshot table (so B
   is impossible without it), record it as a per-game upstream ask — do NOT fabricate.
6. Reload + build.

## Verify (gold standard — compiled SQL, not usedPreAggregations)

5. Re-run the exact probes from this session via `:3004` `/sql` (headers
   `x-cube-workspace: local`, `x-cube-game: cfm_vn`):
   - churn_risk/whales aggregate → expect `external:true`, matched new rollup.
   - member-detail projection (from phase-00) → expect snapshot/originalSql path, no
     `etl_ingame_moneyflow` in compiled SQL.
   - cohort query → still hits existing rollup (no regression).
6. Assert `usedPreAggregations` populated AND no `preagg_*`/CubeStore-dialect leakage for the
   member path. Time a cold member query before/after.

## Measure

7. `cube-dev/scripts/measure-preagg-build.sh` for the new rollup: build seconds, partition
   count, CubeStore size. Confirm hourly sweep stays bounded (current sweeps 0s–5m).

## Success criteria

- Target shapes flip miss→hit (compiled-SQL verified).
- Heaviest member query ≥5 min → CubeStore serve (or >5× faster if still partly raw).
- Build cost added to sweep budget without breaking hourly cadence; SEALED, no FAILED.
- No regression on cohort rollup or other mf_users measures.

## Risks

- Non-additive `count_distinct` can't merge across rollup rows → wrong counts if D1=exact but
  dims don't exactly match query. Mitigate via approx or exact-dim-match (decided D1).
- `originalSql` materialises the whole user table → CubeStore size; check per-game row counts.
- Snapshot may genuinely lack a field member queries need → forces C (upstream); flag, don't
  fake it.
