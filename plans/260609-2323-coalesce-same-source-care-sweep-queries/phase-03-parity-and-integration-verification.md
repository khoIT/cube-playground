---
phase: 3
title: "Parity and integration verification"
status: pending
priority: P1
effort: "1h"
dependencies: [2]
---

# Phase 3: Parity and integration verification

## Overview

Prove the coalesced path is behaviourally identical to the per-playbook path over the
**real** registry predicates, and confirm the query-count win. No new runtime code —
this phase is the safety net that justifies shipping.

## Requirements

**Functional**
1. **Dual-path parity test**: for a representative game's resolved playbooks (jus_vn +
   cfm_vn member sets), over a fixed synthetic cohort of rows, assert that for **every**
   membership playbook the coalesced uid set === the per-playbook (oracle) uid set.
   The oracle = run each predicate's `treeToCubeFilters` through a row-filter directly
   (or the retained single-query fetcher fed the same rows).
2. **Query-count assertion**: with an injected fetch counter, a full cfm_vn-shaped sweep
   issues `< playbookCount` warehouse calls (target collapse of the ~11 *fireable*
   membership queries to ~5, same-cube clusters → one call each).
2b. **Wall-time win vs Phase 0 baseline**: re-run the cfm_vn reset/full-sweep and compare
   total wall time against the `care-sweep-cfm-vn-cohort-query-baseline-report.md` numbers
   from Phase 0. Record the delta (cold, uncontended). A lower query count that does **not**
   reduce wall time means the coalesced clusters weren't the slow ones — surface that and
   defer to Phase 4 (contention) / re-prioritize, rather than declaring success on count alone.
3. **No-regression**: full `server` suite green; the existing
   `care-case-sweep.test.ts`, `care-auto-sweep.test.ts`, anniversary-attribution, and
   `care-sweeps-route` tests pass unchanged.
4. **Flag/guard parity (D2/D3)**: assert the sweep with `CARE_SWEEP_COALESCE=off`
   (per-playbook path) and with it on (coalesced) produce identical uid sets over the
   same cohort — the flag is a pure performance switch. Same for a group forced into the
   D2 cap-fallback: its uids match the coalesced result.

**Non-functional**
- Parity test is data-driven (loop over playbooks) so adding a playbook auto-covers it.
- Document residual divergence risk (e.g. operators not exercised by any current
  predicate) in the test file + `docs/lessons-learned.md` if a parity gap is found+fixed.

## Architecture

Test-only. Use the same in-memory DB + injected-deps harness as
`care-case-sweep.test.ts`. The "oracle" is a tiny row-filter built from
`treeToCubeFilters` + a brute-force comparison **independent** of the matcher — so the
test can't pass by sharing the matcher's bug. (If the only available comparator IS the
matcher, instead assert coalesced-vs-single-query-path equality, where the single-query
path applies real Cube-filter semantics through the retained fetcher fed identical rows.)

## Related Code Files

- Create: `server/test/cohort-coalesce-parity.test.ts`
- Modify (if needed): `server/test/care-case-sweep.test.ts` (query-count case)
- Modify: `docs/lessons-learned.md` (only if a parity gap surfaces)
- Modify: `docs/codebase-summary.md` / `docs/system-architecture.md` (note coalesced
  sweep path — minor, additive)

## Implementation Steps

1. Build the synthetic cohort: rows covering each referenced member with boundary values
   (at/just-below/just-above thresholds, null, in/out of date windows).
2. **Parity loop**: for each membership playbook in `mergePlaybooks(game, members)`,
   compute oracle uids (independent row-filter) and coalesced uids; `expect(coalesced).toEqual(oracle)`.
   Cover jus_vn AND cfm_vn member sets (different availability ⇒ different swept sets).
3. **Query-count**: injected counter; assert total fetches per full sweep < playbook
   count and that mf_users-cluster playbooks triggered exactly one shared fetch.
4. Run full `server` suite (`vitest run`) + `tsc --noEmit`; all green.
5. If any parity gap found → fix in Phase-1 matcher, add the failing row as a regression
   case, note the shape in `docs/lessons-learned.md`.

## Success Criteria

- [ ] For every membership playbook (jus_vn + cfm_vn), coalesced uids === oracle uids.
- [ ] Full sweep issues fewer warehouse calls than playbooks; same-cube clusters = 1 call.
- [ ] Reset/full-sweep wall time recorded vs Phase 0 baseline; win attributable to the
      measured-slow cluster (not just a lower count).
- [ ] Full server suite + tsc green; no existing test modified to pass (only additive).
- [ ] Any discovered parity gap captured as a regression test + lessons-learned entry.

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Oracle accidentally shares the matcher's logic (test proves nothing) | M×H | Oracle is an independent brute-force comparator, or the retained single-query path; never the matcher itself |
| An operator/edge untested because no current predicate uses it | M×M | Phase-1 covers all 16 ops in isolation; document the gap explicitly |
| Synthetic rows miss a real-data shape (e.g. numeric-as-string from Cube) | M×M | Include mixed-type rows mirroring Cube serialization in the cohort |

## Next steps

After green: optional `/ck:code-review` then `/ck:cook` finalize (commit, docs, journal).
The retained per-playbook path means a fast revert is always available if prod parity
ever surprises.
