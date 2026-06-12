# Segment Metric Movement Lakehouse Plan — Scout-First Prevented Duplicate Snapshot Build

**Date**: 2026-06-12 15:54
**Severity**: Medium
**Component**: Data lakehouse, Trino Iceberg, segment membership, Cube rollup strategy
**Status**: Plan locked, awaiting cook-phase approval

## What Happened

Brainstorm session kicked off by boss/Kelly proposal: build AutoResearch function to find "actionable segments" + experimentation-loop capabilities. Session diagnosed the blocker: AutoResearch lacks a cheap objective evaluator — "actionable" is a slow human+outcome label. The experimentation loop IS the prerequisite that manufactures reward signals (decision ledger → labeled (segment, intervention, lift) examples → ranking problem).

Scout-first discovery prevented a duplicate build: daily segment-membership snapshot **already exists** (stag_iceberg.khoitn.segment_membership_daily + _delta, nightly job server/src/jobs/snapshot-segment-membership.ts, commit ac25dfc). This was the most expensive part of the proposed flow. Immediate pivot: build on top of what exists rather than re-engineering.

8-phase plan locked (plans/260612-1554-segment-metric-movement-lakehouse/). Tasks #24–#30 hydrated with full dependency chain. New plan also blocks sibling CubeStore rollup plan (260610-1709-schema-per-game-membership-rollup) — serve-layer materialization now waits on query-time latency/restatement evidence from phases 5–6.

## The Brutal Truth

The relief here is real. We almost built a 1.8B-row/year fanout table that would've been useless. Boss suggested a direction; brainstorm + scout found what already exists + identified the real problem (cheap evaluation signal, not raw data). Process worked. The frustration: plan complexity jumped from "snapshot daily metrics" to "3 cohort lenses + join-chain validation + per-game identity-namespace land mines." This is now a 6–8 week integration effort, not a 2-week mart.

User requirement injection halfway through brainstorm (per-game mart eligibility with MANDATORY join-probes) is correct but adds discovery weeks. jus_vn has dual-row mf_users; cfm_vn has vopenid identity traps. If we skip validation, the metrics will be structurally correct but silently wrong (joining on user_id to a table with 2 rows per uid). Seen this before. Non-negotiable.

## Technical Details

**Existing snapshot (ac25dfc):**
- stag_iceberg.khoitn.segment_membership_daily (full membership at query time each night)
- stag_iceberg.khoitn.segment_membership_delta (daily adds/drops)
- Partitioned by snapshot_date, queries are cheap (seconds for 500k members × 10 metrics)
- Zero join fanout — query-time self-intersection only

**Locked decisions:**
1. **Non-recomputable: Persist segment DEFINITIONS only.** (Membership already lives in Iceberg; segment definitions are new — add segment_definition_daily table, nightly snapshot of all active definitions by game + segment_id.)
2. **Query-time JOIN immutable per-user daily marts.** (e.g., cfm user_recharge_daily, jus recharge_transaction_daily.) No full member-info fanout (~1.8B rows/yr for one 500k-member segment × 10 metrics, zero info gain).
3. **3 cohort lenses = query-time constructs.** Not materialized yet:
   - **Current:** members as of snapshot date
   - **Entry-cohort:** members as of segment entry_date (survivor-bias labeling mandatory)
   - **Stayers + anchor:** intersection of current ∩ entry_cohort (tracks retention via per-game metrics)
4. **Server-side Trino BEFORE any Cube model.** Lenses are anchor-parameterized self-intersections; Cube cannot express them. Build segment_metric_daily query as stored procedure / view set, test latency/restatement; only then gate materialization.
5. **Materialization (segment_metric_daily) GATED on measured latency/restatement evidence.** No pre-agg until phases 5–6 prove query perf is a blocker.

**Per-game eligibility matrix (user requirement):**
- Per game (cfm_vn, jus_vn, muaw_vn), audit:
  - User identity namespace (cfm: vopenid/user_id mix; jus: dual-row mf_users with user_type=st_dummy)
  - Join probes: attempt join mf_users→user_recharge_daily, count rowcount before/after (detect cardinality explosions)
  - Document per-game rowcount expectations (e.g., "jus: expect 2.1x inflation; use explicit user_type='paying' filter to recover 1x")

## What We Tried

1. **AutoResearch as the starting point:** Quickly hit "how do we label 'actionable'?" Recognized this is fundamentally a supervised learning problem, not open-ended search. Branched to prerequisite (decision ledger + labeled examples).
2. **Proposed full member-info fanout:** (segment_id, user_id, entry_date, recharge_30d, games_active_7d, vip_tier, …). Rejected on rowcount (1.8B/yr for one segment) + no-gain (segment already has members; metrics add 10 columns that replicates existing Cube measures). Replaced with lean query-time lens.
3. **Cube model for lenses directly:** Cube lacks self-intersections + parameterized cohort filters. Deferred to server-side Trino; if latency proves acceptable, optionally materialize downstream.

## Root Cause Analysis

Why the brainstorm pivoted:
- Initial framing: "build actionable segment discovery" → implies a recommender/search problem.
- Reality check: "actionable" requires outcome data (did the intervention work?). AutoResearch has no outcome loop. The experimentation loop (track decision → measure lift → retrain) is the actual blocker.
- Scout-first on lakehouse: discovered that membership snapshot already exists. Immediately reframed as "build metrics on top of existing snapshot" vs "build new snapshot."
- User feedback: per-game identity validation is critical. Prior bugs (cfm vopenid, jus dual-row mf_users, join explosion) have happened before in the codebase (see docs/lessons-learned.md). Non-negotiable.

## Lessons Learned

1. **Scout-first is cheap.** 30 minutes of grep + MEMORY context prevented a 2-week wasted build. Always check if it exists before designing new plumbing.
2. **"Actionable" is a training signal, not an open query.** Open-ended AutoResearch optimizing for undefined "actionability" will chase ghosts. Supervised learning (decision ledger → labeled examples → ranking) is the right framing.
3. **Identity namespace validation must happen first.** jus dual-row bug (mf_users: user_id + user_type=st_dummy), cfm vopenid trap, join cardinality explosions — all have happened. Per-game probe checklist is mandatory before any metric joins.
4. **Lenses are query-time constructs, not materialized rows.** Trying to fanout all lenses into a wide mart causes 1.8B-row/yr tables with no info gain. Self-intersections (current ∩ entry_cohort) should stay in Trino SQL, not ETL.
5. **Materialization is a performance optimization, not a design decision.** Test query latency FIRST on server-side Trino. Only gate a pre-agg if measured latency is a blocker. Avoids premature materialization.

## Next Steps

**Phases 1–8 (plans/260612-1554-segment-metric-movement-lakehouse/):**
1. **Phase 01:** Prod verification (is segment_snapshot_enabled? how many games use it?)
2. **Phase 02:** Per-game mart-eligibility matrix + join probes (cfm, jus, muaw identity audit)
3. **Phase 03:** Treatment-events contract doc (shape of intervention events, retention labeling rules)
4. **Phase 04:** Segment definition snapshot (segment_definition_daily table, nightly upsert)
5. **Phase 05:** Trajectory panel (query-time 3-lens metric series, Trino stored proc, latency SLO)
6. **Phase 06:** Cube model (3 lenses as dimensions, legacy metrics as measures, verify rollup serve performance)
7. **Phase 07:** GATED materialization (if phase 5–6 latency > threshold, gate segment_metric_daily pre-agg; else leave as view)
8. **Phase 08:** DEFERRED as-of-entry attribute picker (as_of_entry_cohort date must be snapshotted per segment; deferred until phase 07 proves demand)

**Blockers resolved:**
- Sibling plan (260610-1709-schema-per-game-membership-rollup) CubeStore serve-layer now waits on phase 5–6 latency evidence.
- Added note to that plan's plan.md linking to this phase timeline.

**Unresolved questions:**
- **Prod SEGMENT_SNAPSHOT_ENABLED state:** Phase 01 must check if prod cube has snapshot enabled and at what game coverage.
- **Mart immutability/retention:** segment_definition_daily — how long to retain? Immutable after snapshot? Need data governance policy.
- **As-of-entry attribute scope:** Phase 08 deferred; user still needs to pick which attributes (vip_tier, games_active, recharge_30d) to snapshot as-of-entry vs query-time. Requires product decision.

**Owner:** User to review plan before /ck:cook phase. Session complete; ready for implementation delegation.

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Brainstorm + planning session identified that segment-membership snapshot already exists (ac25dfc); reframed as metric-lens problem over existing data. 8-phase plan locked with per-game identity validation mandatory. Sibling CubeStore plan now blocked on phases 5–6 latency evidence.

**Concerns:** Plan scope expanded (3 cohort lenses + 2-week identity validation) vs. initial "daily snapshot" framing. User requirement injection mid-brainstorm adds discovery weeks. Materialization decision deferred to post-phase-6 latency testing — no pre-agg spec yet.
