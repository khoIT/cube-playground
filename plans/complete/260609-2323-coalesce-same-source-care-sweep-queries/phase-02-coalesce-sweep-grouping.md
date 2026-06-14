---
phase: 2
title: "Coalesce sweep grouping"
status: pending
priority: P1
effort: "2.5h"
dependencies: [1]
---

# Phase 2: Coalesce sweep grouping

## Overview

Wire the Phase-1 matcher into `runCaseSweep`: group cohort-queryable playbooks that
share `(base cube, identity, anchor)`, run ONE wide query per group, then derive each
playbook's uids in-process. Single-playbook groups keep the existing one-query path.
All sweep invariants preserved.

## Requirements

**Functional**
1. After the existing per-playbook gating (enabled / available / not-trigger /
   has-predicate / non-empty-filter), partition the remaining **swept** playbooks into
   groups keyed by:
   - `cube` = `dataRequirements[0].split('.')[0]`
   - `identity` = `resolveIdentityField(cube, …)` (group only when identical)
   - `anchorKey` = the windowed date member that drives `resolveDataAnchor`, or `null`
     when the predicate has no relative window (`findWindowedDateMember`). Different
     anchors ⇒ different groups (an anchor is one probe shared by the group).
2. For each group, build ONE wide query:
   - `dimensions`: `identity` + every **dimension** member referenced by any group
     predicate; `measures`: every **measure** member referenced (per-user, grouped by
     identity).
   - **Member-kind source (D1, confirmed):** classify via a new
     `extractMemberKinds(meta, gamePrefix): Map<member,'measure'|'dimension'>` beside
     `extractLogicalMembers` in `availability.ts`, populated from the SAME `/meta`
     `executeSweep` already fetches (`care-sweep-execute.ts:89`) and threaded into
     `runCaseSweep` → `fetchGroup`. **No new Cube/meta call.** A referenced member absent
     from the map → treat the group as non-coalescable → per-playbook fallback (fail-safe).
   - `filters`: VIP-base gate only (`gateWithVipBase`) — NOT the per-playbook predicates.
   - Resolve `anchorDate` once per group (single `resolveDataAnchor` when `anchorKey`).
3. For each playbook in the group: `filters = treeToCubeFilters(gated, {anchorDate})`,
   then `uids = rows.filter(r => matchesCubeFilters(r, filters)).map(r => r[identity])`,
   deduped. Feed those uids to `applyMembershipResult` exactly as today.
4. **Cohort-cap parity guard (D2, confirmed):** if a group's wide query returns
   `rows.length === COHORT_CAP` (truncation suspected — the wide query caps the *whole
   VIP base*, unlike a per-playbook query that caps *matchers*), **fall back to
   per-playbook queries for that group** and `console.warn`. Guarantees parity when the
   base exceeds the cap; no-op while it's under (cfm_vn base is small).
5. **Rollout toggle (D3, confirmed):** env flag `CARE_SWEEP_COALESCE` (**default ON**).
   When off, `runCaseSweep` skips grouping entirely and uses the per-playbook path
   wholesale — instant prod disable without a revert.
6. **Single-playbook group** → fall through to the existing `makeCubeCohortFetcher`
   single query. No wide-query machinery when there's nothing to save (YAGNI).
7. Preserve summary **order** = merged-playbook order (re-sort group results back).

**Non-functional**
- Per-group error isolation: a group's wide query failing marks **each** of its
  playbooks `skipped: 'query-failed'` (same shape as today's per-playbook catch) and
  the rest of the sweep continues — never a whole-sweep abort.
- Groups still run through `mapWithConcurrency(SWEEP_CONCURRENCY)` (compose, don't
  replace, the shipped parallelism — now the unit of concurrency is a group).

## Architecture

Keep `runCaseSweep` as the orchestrator; extract the grouping + wide-fetch into small
helpers in `care-case-sweep.ts` (or a sibling `cohort-coalesce.ts` if it pushes the
file > 200 LOC — check and split if so).

```
runCaseSweep
  ├─ merge + per-playbook gate (unchanged) → swept[]
  ├─ buildGroups(swept)                      → CohortGroup[]  (cube,identity,anchorKey,playbooks)
  └─ mapWithConcurrency(groups, 6, fetchGroup) → flat summaries, re-ordered
fetchGroup(group)
  ├─ size 1            → existing single-query fetcher (oracle path)
  ├─ resolveDataAnchor once (if anchorKey)
  ├─ ONE wide loadWithCtx(identity + members, VIP-gate, COHORT_CAP)
  └─ per playbook: treeToCubeFilters → matchesCubeFilters → uids → applyMembershipResult
```

**Anniversary (18):** stays its own evaluation (needs `matchByUid` via
`anniversaryMilestoneForDate`). It MAY share the wide query's `first_active_date`
column, but computes milestone attribution in JS as today — do not try to fold
attribution into the generic matcher.

## Related Code Files

- Modify: `server/src/care/care-case-sweep.ts` (`runCaseSweep`; add `buildGroups`,
  `fetchGroup`; `makeCubeCohortFetcher` retained for size-1 + oracle + D2 fallback)
- Modify: `server/src/care/availability.ts` (add `extractMemberKinds` — D1)
- Modify: `server/src/care/care-sweep-execute.ts` (thread the meta-derived kind map +
  `CARE_SWEEP_COALESCE` flag read into `runCaseSweep` — D1/D3)
- Create (only if size guard trips): `server/src/care/cohort-coalesce.ts`
- Modify: `server/test/care-case-sweep.test.ts` (group coalescing, D2 cap fallback, D3 flag-off)
- Read: `server/src/care/playbook-merge.ts` (`ResolvedPlaybook`),
  `server/src/care/resolve-data-anchor.ts`, `server/src/services/resolve-identity-field.ts`

## Implementation Steps

1. **TDD-first** — extend `care-case-sweep.test.ts` with an injected wide-fetch dep so
   no Cube is needed:
   - Two same-cube/same-identity/no-anchor membership playbooks → assert **one** wide
     fetch call, and each playbook's opened uids match its predicate over the shared rows.
   - Different identity OR different anchor → assert **separate** fetches (not coalesced).
   - Single membership playbook → assert it uses the single-query path (1 fetch, no
     wide-member union).
   - Group wide-fetch throws → all its playbooks `skipped:'query-failed'`, siblings in
     other groups still sweep (error isolation).
   - Summary order unchanged vs a serial full sweep (reuse the order oracle test pattern
     from Phase-shipped concurrency test).
   - `onlyPlaybookId` (manual single-segment) → still single path, `pruneLapsed` honoured.
   - **D2 cap guard:** wide fetch returns exactly `COHORT_CAP` rows → group falls back to
     per-playbook fetches (assert per-playbook fetcher invoked for each + warn), uids still correct.
   - **D3 flag off:** `CARE_SWEEP_COALESCE=false` → no grouping, per-playbook path used for
     all (assert fetch count == playbook count), results identical to coalesced.
   - **D1 member-kind:** a measure-bearing predicate puts the member in `measures`, a scalar
     in `dimensions` (assert the wide query shape from the injected fetch args).
   - **Multi-row-per-user mart (highest divergence risk):** a per-user-per-day cube
     (`user_gameplay_daily` is the real case — playbooks 06/08/09/17) returns **N rows per
     user** from the wide query. Assert a user is in a playbook's uid set iff **ANY** of
     their rows matches that playbook's `CubeFilter[]` (the matcher is per-row; the
     uid-derivation maps rows→identity then dedups, so "any row matches" must hold), and
     that the per-user dedup yields exactly the per-playbook (single-query) oracle uids
     over the same rows. Include a user whose row A matches playbook 06 but row B matches
     playbook 08 — confirm each lands in the correct uid set, no cross-contamination.
2. Refactor the cohort fetch behind a `SweepDeps`-style seam so the wide query is
   injectable (mirror the existing `fetchCohortUids` injection) — keeps the driver
   Cube-free under test.
3. Implement `buildGroups` (grouping key) + `fetchGroup` (wide query + per-playbook
   in-process filter). Classify members dim-vs-measure from already-loaded meta.
4. Wire anniversary attribution through the wide-query rows (source `first_active_date`,
   compute milestone in JS) — assert the existing anniversary attribution test still passes.
5. Size check `care-case-sweep.ts`; split to `cohort-coalesce.ts` if > 200 LOC.
6. tsc + full server suite green.

## Success Criteria

- [ ] Same-cube/identity/anchor membership playbooks share ONE wide query; uids per
      playbook identical to the per-playbook path.
- [ ] Distinct identity/anchor ⇒ distinct queries; single-playbook ⇒ single-query path.
- [ ] Group query failure isolates to that group's playbooks; sweep continues.
- [ ] Anniversary attribution, `pruneLapsed`, fail-closed empty-filter, summary order,
      VIP gating, dedup — all unchanged (existing tests green).
- [ ] Groups run concurrently via `mapWithConcurrency`.
- [ ] D1: member kinds sourced from threaded meta map (no extra `/meta` call); unknown
      member → per-playbook fallback.
- [ ] D2: wide query at `COHORT_CAP` → per-playbook fallback for that group + warn.
- [ ] D3: `CARE_SWEEP_COALESCE=false` → per-playbook path wholesale; results identical.
- [ ] Multi-row-per-user mart (`user_gameplay_daily`): "any row matches" + per-user dedup
      yields uids identical to the per-playbook oracle; no cross-playbook contamination.

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Wide query selects a member that's actually a measure as a dimension (or vice-versa) → Cube 400 | M×H | Classify from loaded cube meta; test the mf_users (scalar) + a measure-bearing group; group fetch failure is isolated, not fatal |
| In-process uid set diverges from Cube path | M×H | Phase-1 matcher + Phase-3 dual-path parity tests; oracle path retained |
| Coalescing changes which rows the VIP gate returns vs per-playbook (gate identical, but limit/cap interaction) | L×M | Same `gateWithVipBase` + `COHORT_CAP`; assert row set ⊇ each predicate's matchers |
| File grows past modularization limit | M×L | Split to `cohort-coalesce.ts` |
| Anchor sharing wrong when group mixes windowed + non-windowed | M×M | `anchorKey` in group key; non-windowed predicates ignore `anchorDate` (translator no-op) |
| Multi-row-per-user mart: wide query returns N rows/user, naive uid derivation double-counts or mis-attributes | M×H | "Any row matches" + dedup-by-identity; explicit multi-row parity test (06/08 distinct-row case) vs per-playbook oracle |
