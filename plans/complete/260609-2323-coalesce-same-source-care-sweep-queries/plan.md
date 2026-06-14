---
title: "Coalesce same-source care-sweep cohort queries"
description: "Speed up the care sweep/reset (currently minutes for cfm_vn) on two levers: (1) coalesce same-source cohort queries — group playbooks sharing a base cube + identity into ONE wide query, filter each predicate in-process (~11 fireable → ~5 queries); (2) a shared cube_api concurrency budget so sweep + dashboard + member360 don't stampede one warehouse. Baseline-measured first. No warehouse/DB changes."
status: pending
priority: P1
effort: ~9h
branch: "main"
tags: [care, sweep, performance, cube, tdd]
blockedBy: []
blocks: []
created: "2026-06-09T16:30:23.012Z"
createdBy: "ck:plan"
source: skill
---

# Coalesce same-source care-sweep cohort queries

## Overview

The care sweep fires **one Cube `/load` per playbook** (`makeCubeCohortFetcher`,
`care-case-sweep.ts:169`): `dimensions:[identity]`, `filters: VIP-gate AND <predicate>`.
For cfm_vn that's ~21 cold-Trino scans, several hitting the **same table with the
same identity**, differing only in the `WHERE` clause (4 playbooks just scan
`mf_users`). Cohort queries can't route to pre-aggs (rollups are cohort-grain;
verified this session), so the only levers are query *parallelism* (shipped:
`SWEEP_CONCURRENCY=6`, commit `22dde1c`) and query *count* — this plan.

**Approach:** group playbooks by `(base cube, identity, time-anchor)`; issue ONE
wide query per group selecting `identity + union(referenced members)` gated by the
VIP base only; then evaluate each playbook's filter **in-process** against the
returned rows to derive its uid set. Of cfm_vn's 21 playbooks only ~11 are *fireable*
membership queries (the rest are trigger/unavailable → already skipped); coalescing
collapses those ~11 → ~5, composing with the existing bounded-concurrency pool.
**Phase 0 measures which clusters are actually slow before committing to the win;
Phase 4 adds the complementary contention lever.**

**Core risk = parity.** The coalesced path must produce *byte-identical uid sets*
to the per-playbook Cube path. Mitigation baked into the design: evaluate the
**translated `CubeFilter[]`** (output of `treeToCubeFilters`, the same function
the gate query uses) rather than the raw predicate tree — so relative-date
expansion, anniversary OR-expansion, and malformed-leaf drops are shared, and the
only new surface is Cube operator-comparison semantics. The per-playbook fetcher
stays as the executable **oracle** in tests.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 0 | [Baseline measurement + query-shape verification](./phase-00-baseline-measurement.md) | Pending |
| 1 | [In-process Cube-filter matcher](./phase-01-in-process-cube-filter-matcher.md) | Pending |
| 2 | [Coalesce sweep grouping](./phase-02-coalesce-sweep-grouping.md) | Pending |
| 3 | [Parity and integration verification](./phase-03-parity-and-integration-verification.md) | Pending |
| 4 | [Cross-feature Cube contention budget](./phase-04-contention-concurrency-budget.md) | Pending |

Phase 0 measures the per-cube cohort-query baseline first — coalescing only pays where the
collapsed queries are actually slow (and confirms which clusters those are). Phase 1 is the
foundation (pure, independently testable). Phase 2 wires it into the sweep. Phase 3 proves
end-to-end parity + the query-count win **and the wall-time win against the Phase 0
baseline**. TDD per phase: tests first, the existing Cube-filter path as the correctness oracle.

**Phase 4 is an independent, complementary lever** (no code overlap with 1-3): a shared
`cube_api` concurrency budget so the sweep, dashboard card-runner, and member360 don't sum
to ~13 concurrent cold scans on one warehouse. Coalescing cuts query *count*; Phase 4 cuts
*contention*. For "a reset takes minutes," contention is likely the larger amplifier — Phase 4
may be the fastest single relief and can ship before or without the coalescing work.

**Two levers, not one.** Coalescing alone roughly halves the sweep's query waves but is
bounded by per-query cold-Trino cost (which pre-aggs cannot fix — cohort queries are
row-grain; verified). Moving a reset from minutes toward seconds needs Phases 1-3 (count)
**+** Phase 4 (contention), with Phase 0 confirming the targets are the slow ones.

## Locked decisions (do not reverse)

- **Evaluate translated `CubeFilter[]`, not raw `PredicateNode`** — inherits date
  expansion / anniversary / drop semantics from `treeToCubeFilters`; parity surface
  shrinks to operator comparison only.
- **Per-playbook fetcher kept** as the oracle and as the fallback path for any group
  that can't coalesce (e.g. mixed anchors, single-member groups). Not deleted.
- **No warehouse/model changes, no DB schema changes.** Pure server compute change.
- **Anniversary (18) keeps `matchByUid` milestone attribution** (`anniversaryMilestoneForDate`);
  it sources `first_active_date` from the shared wide query but computes the
  milestone in JS exactly as today.
- **Coalesce only where it pays:** YAGNI — a group of 1 playbook uses the existing
  single-query path unchanged (no wide-query machinery for nothing).

## Invariants to preserve (regression guard)

VIP-base gating · identity dedup · fail-closed on empty-filter predicates
(`treeToCubeFilters(...).length === 0` → skip) · per-playbook error isolation (one
group/query failure ≠ whole-sweep abort) · anniversary attribution · `pruneLapsed`
(manual single-playbook) behaviour · summary **order** · trigger/unavailable/disabled
still skipped with the same reason.

## Key verified facts

- Per-playbook query shape + identity resolution: `care-case-sweep.ts:169-222`.
- VIP gate `mf_users.ltv_total_vnd >= 1_000_000` via `gateWithVipBase` — `:33-46`.
- Translator handles relative-window expansion, anniversary OR, malformed-drop —
  `services/translator.ts:76-134`. **Read-only oracle for this plan.**
- 16 `LeafOperator`s + `CubeLeafFilter` shape — `types/predicate-tree.ts`.
- cfm_vn same-cube clusters: `mf_users` = 02/14/18(+01); `user_gameplay_daily` =
  06/08/09/17; rolling marts = 03/04/15 (anchor-gated) — `care/playbook-registry.ts`.
- Bounded pool `mapWithConcurrency` — `services/bounded-concurrency.ts`.

## Related plans

- `plans/260609-2232-condition-operator-uniformity/` (in-progress) — adds
  `notInDateRange` op + segmented builder. **Weak coupling, no write conflict:** it
  *modifies* `translator.ts`/`predicate-tree.ts`; this plan only *reads* them. Because
  the matcher evaluates translated Cube operators, any new tree op it introduces is
  covered for free — the matcher must just support the full Cube operator set
  (incl. `notInDateRange`). No blocking dependency.

## Dependencies

None blocking. Builds on shipped parallelism (`22dde1c`).

## Validation Log

### Session 1 — 2026-06-09 (critical-questions interview)

**Verification (Standard tier, 3 phases — Fact Checker + Contract Verifier):**
- Claims checked: 9 · Verified: 7 · Failed: 0 · Unverified-then-resolved: 2
- ✅ `makeCubeCohortFetcher`/`gateWithVipBase` (`care-case-sweep.ts:169,33`), `treeToCubeFilters`
  expansion (`translator.ts:76-134`), `resolveDataAnchor`+`findWindowedDateMember`
  (`resolve-data-anchor.ts:80,121`), `resolveIdentityField` (`resolve-identity-field.ts:85`),
  `mapWithConcurrency` (`bounded-concurrency.ts`), cfm_vn clusters (`playbook-registry.ts`).
- ⚠️ Resolved: `getGameMembers` returns `Set<string>` (names only) — `extractLogicalMembers`
  (`availability.ts:53`) collapses away dim/measure kind, though `meta` carries it
  (`cube.measures` vs `cube.dimensions`). → Decision D1.
- ⚠️ Resolved: `COHORT_CAP=50_000` means different things per path (matchers vs total
  base). → Decision D2.

**Decisions confirmed (user, 2026-06-09):**
- **D1 — Member-kind source:** add `extractMemberKinds(meta, gamePrefix): Map<member,'measure'|'dimension'>`
  beside `extractLogicalMembers` in `availability.ts`; populate it from the SAME `/meta`
  `executeSweep` already fetches (`care-sweep-execute.ts:89`) and thread the map into
  `runCaseSweep` → `fetchGroup`. **Zero extra Cube calls.** (Adds `care-sweep-execute.ts`
  + `availability.ts` to Phase-2 touchpoints.)
- **D2 — Cohort-cap parity guard:** when a group's wide query returns
  `rows.length === COHORT_CAP` (truncation suspected), **fall back to per-playbook queries
  for that group** and `console.warn`. No behaviour change while the VIP base < cap (cfm_vn
  base is small). Prevents silent missed-matcher divergence on a large base.
- **D3 — Rollout toggle:** env flag `CARE_SWEEP_COALESCE` (**default ON**). When off,
  `runCaseSweep` uses the existing per-playbook path wholesale. Lets prod disable instantly
  without a revert; retained per-playbook path is the fallback target.

### Whole-Plan Consistency Sweep — Session 1
Re-read plan.md + all 3 phases after propagation. D1/D2/D3 propagated to Phase 2 (+ Phase 3
adds a cap-guard fallback test and a flag-off test). No stale terms / contradictions. The
"classify from already-loaded meta" prose in Phase 2 replaced with the concrete D1 mechanism.
No unresolved contradictions.
