# Segment Metric Movement Lakehouse — Cook Execution: Phase 1–6 Shipped, Materialization Gated

**Date**: 2026-06-12 18:42
**Severity**: Medium
**Component**: Lakehouse (Trino Iceberg), segment metrics UI, trajectory/movement cards, snapshot observability
**Status**: DONE — phases 1–6 shipped; phase 7 (materialized aggregate) skipped via gate evidence; phase 8 deferred by design

## What Happened

Implemented phases 1–6 of the segment-metric-movement plan (commit c192d0a, plan 260612-1554-segment-metric-movement-lakehouse). Created three-lens cohort metric system: current-member, entry-cohort, and stayers lenses joining per-user daily recharge marts at query time. Added segment_definition_daily lakehouse table (nightly snapshot of all active segment definitions per game). Gated phase 7 (materialized segment_metric_daily pre-agg) based on measured live latency: P95 ≈ 1.7s, well below the ~8s threshold that would justify a pre-agg. Phase 8 (as-of-entry attribute picker) deferred by design — phase-5 latency acceptable; no restatement or volume-consumer evidence to justify another table.

UI shipped: trajectory + metric-movement cards on segment detail page. Admin observability: lakehouse snapshot-run status + errors visible in Settings tab (existing admin panel, no new surface).

Sibling phase-6 Cube model verified rollup serve perf on cfm_vn (live data, 314 segment entries × 10 metrics × 3 lenses = 9420 points, latency stable). No regression.

## The Brutal Truth

Three lens-semantics bugs landed during live verification that green unit tests completely missed. This is exactly why the plan mandated query-time validation over pre-agg shortcuts.

**Entry-cohort cumulative double-count:** A 3969-member segment showed cumulative 7937 entry-lens members. Root cause: gap-day artifact. When a member exited segment (snapshot_date 2026-06-05) and re-entered later (2026-06-10), the delta-join restatement counted the re-entry delta as a new row. The entry lens measures "ever entered," not "cumulative unique entries." Fix: SQL dedupe by `MIN(snapshot_date)` per uid. jus_vn segment re-verified post-fix; entry count dropped to expected 3969.

**Dead-join false positive:** jus segment's payer lens showed warning "no matching users in recharge_transaction_daily on any snapshot day." User feared a schema/identity bug. Investigation: legitimate zero — that segment genuinely had zero same-day payers across all snapshot days in the test window (members entered after payday). Dead-join detection threshold raised from ≥1 to ≥5 all-zero cohort days before surfacing the warning. Avoids false alarms on low-activity segments.

**Entry lens counting pre-entry activity:** Code review caught that the entry lens was joining mf_users → user_recharge_daily WITHOUT filtering by entry_date. A member entering segment on day 20 contributed recharge activity from days 1–19. This is structurally wrong. Per-member first-entry clock implemented: `fact.date >= cohort.first_entry` filter in the join. User confirmed intent: "metric movement starts at entry, not at member birth." cfm_vn segment re-verified post-fix: series correctly starts at first entry day, gap-day mart tracking intact, entrant count rose from 314 to 343 (older members now properly in window).

**Unreachable warning on entry lens:** Review also flagged that the entry lens performs an INNER JOIN with the cohort table. Logically, if a dead-join warning fires, the join yields zero ROWS, not zero VALUES. Per-point warning scan would never fire on that lens. Root cause: copy-paste from current lens (which uses LEFT JOIN, can have null VALUE side). Fixed by special-casing empty-result detection: entry lens checks rowcount(JOIN result) before scanning; current/stayers lenses scan per-point VALUES. Unreachable code eliminated.

## Technical Details

**Shipped artifacts:**
- Trino Iceberg table: `stag_iceberg.khoitn.segment_definition_daily` (nightly snapshot of segment name, entry_type, filters, scope, game per segment_id)
- Three-lens query (server-side Trino stored proc, query-time self-intersections):
  - **Current:** `snapshot_date = today`
  - **Entry-cohort:** `snapshot_date = segment.entry_date` (survivor-bias cohort)
  - **Stayers:** `current ∩ entry-cohort`
- Per-user daily marts joined at query time (e.g., cfm: user_recharge_daily; jus: recharge_transaction_daily)
- UI: segment detail page + trajectory card (line chart: entry/current/stayers over time) + metric-movement card (3 lens selector, metric picker, delta % vs previous period)
- Registry gating: proof of per-game (game, mart) eligibility before exposing lenses (cfm_vn + jus_vn probed; muaw_vn deferred)

**Critical bug fixes (live verification only):**
1. Entry-cohort dedupe: `GROUP BY uid, HAVING MIN(snapshot_date)` to eliminate re-entry double-counts
2. Dead-join threshold: `≥5 all-zero days` before warning (was ≥1)
3. Entry-lens date filter: `fact.date >= cohort.first_entry` (was unbounded, counted pre-entry activity)
4. Entry-lens warning logic: special-case rowcount=0 detection (was checking VALUES on INNER JOIN, unreachable)

**Latency gate decision:**
- P95 query latency: 1.7s (current lens, 500k members, 10 metrics)
- Threshold for materialization: ≥8s (SLO misses)
- Decision: no pre-agg. Query-time join acceptable. Defer phase 7 (segment_metric_daily materialization).

## What We Tried

1. **Pre-agg first:** Initial design sketched segment_metric_daily as nightly materialized wide table (segment_id, snapshot_date, uid, entry_date, recharge_30d, games_active_7d, …). Shelved when entry-lens double-count bug surfaced — materialization locks semantics. Query-time join reveals bugs faster.

2. **Single-pass entry cohort:** Attempted to define entry-cohort as "snapshot_date = segment.entry_date" without deduplication. Green unit tests (synthetic data, no re-entries). Failed on real data: members re-entering segments show cumulative rows. Added `GROUP BY uid, MIN(snapshot_date)` dedupe.

3. **Suppress dead-join warnings entirely:** First instinct after false positive: remove warning. User pushed back: zero same-day payers is a valid concern for low-revenue segments. Kept warning, raised threshold to ≥5 consecutive zero-result days.

## Root Cause Analysis

Why bugs only surfaced live:

1. **Unit test data is synthetic.** No re-entry scenarios in test snapshots; cumulative double-count invisible. Real segment members churn in/out; test cohorts are static inserts.

2. **Code review caught structural issues, tests missed semantics.** Entry-lens pre-entry leak was a logic error (missing WHERE clause), not a null-pointer or type issue. Linting + type checks green. Real data revealed the semantic bug.

3. **"No matching records" is ambiguous.** Dead-join warning intended to catch schema mismatches (e.g., user_id column renamed). Real data showed the warning also fires on legitimate zero (low-activity segments, zero payers in test window). Threshold disambiguates signal from noise.

4. **Concurrent session friction.** Two Claude sessions editing the same worktree introduced merge conflicts. One session imported `src/QueryBuilderV2/compare/format-delta.ts` (module never existed on disk) → Vite dev overlay crashed the entire app. Reconstructed the module from call sites (`deltaPct = (new - old) / old`; tone positive/negative/flat based on sign). Stash/pop race also occurred on unrelated files; resolved via `checkout --theirs`. Rule adopted: no git stash ops while concurrent sessions overlap.

## Lessons Learned

1. **Live verification catches what unit tests cannot.** Semantic bugs (re-entry double-count, pre-entry activity leakage) are invisible to synthetic-data test suites. Real data + feature-flag rollout is the only true test. Green tests do not mean correct semantics; they mean correct syntax.

2. **Materialization locks semantics; queries reveal bugs.** Materializing entry-cohort as a nightly table would have baked in the double-count bug. Keeping it as a query-time self-intersection exposed the bug during review and allowed a one-line fix. Premature materialization === premature semantic lock.

3. **Warnings need a threshold to avoid false alarms.** "Zero matching records" can mean schema mismatch OR legitimate zero (no activity). Threshold (≥5 consecutive zero-result days) separates real from noise. User confirms: this is better than either "always warn" or "never warn."

4. **Code review for logic, not just syntax.** Linting + type checks approve the entry-lens pre-entry leak. Semantics require human reading: "does this WHERE clause match the intent?" Linting won't catch it.

5. **Concurrent sessions on one worktree require stash-free discipline.** Stash/pop races parallel writes. Fallback: `git checkout --theirs` on conflicts, OR use separate worktrees per session. Lesson: enforce no-stash-while-parallel rule; or provision worktrees upfront.

## Outstanding / Next Steps

**Phase 8 (as-of-entry attribute picker) deferred by design:** User indicated demand for "snapshot recharge_30d as-of segment entry" (not as-of-query). Current implementation measures metrics at query time. If user needs historical snapshot values (e.g., "what was their recharge_30d on their entry date?"), phase 8 adds as-of-entry_date snapshot. Depends on product/user decision post-launch. No latency blocker.

**Production environment:**
- SEGMENT_SNAPSHOT_ENABLED not found in prod Vault (jupyter/prod/khoitn/cube-playground). Nightly segment_membership_daily snapshot dormant in prod. Needs: (1) verify flag exists in prod cube config; (2) enable on exactly ONE instance (avoid duplicate snapshot runs); (3) redeploy; (4) verify snapshot job fires. Partitions built so far via manual runs (2026-06-10, 2026-06-12) to unblock testing.
- Phase-4 "edit → new hash next day" and phase-5 "≥7-day history" criteria will be fully exercised with time/accrual in prod.

**Code debt:**
- Three-lens semantics now documented in source (`segment-metric-trajectory.ts`); add entry to `docs/lessons-learned.md` for future PRs touching this area.

---

**Status:** DONE
**Summary:** Phases 1–6 shipped with segment-definition snapshot + three-lens query-time metrics; latency gate (P95 1.7s) skipped phase 7 materialization; four live-data bugs caught by review/verification (entry-cohort dedupe, dead-join threshold, pre-entry leak, unreachable warning) — all invisible to unit tests.
