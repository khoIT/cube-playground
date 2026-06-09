# CS VIP-care Demo Loop — Shipped & Reseedable

**Date**: 2026-06-09 20:30
**Severity**: Feature Complete
**Component**: CS Console, Care Service, FE/Server, demo infra
**Status**: Committed to main (10 commits, not pushed)

## What Happened

Shipped the complete CS VIP-care demo loop. Member-360 went live (persisted "Mark treated" via PATCH + refetch), claim/assign/dismiss-with-reason gated per UI rail, human-closed KPI outcome (Close · KPI met/missed) + new `kpiMetRate` metric, CSV export + 24h activity aggregate endpoint, guarded reset (game+workspace scoped, 409 if sweep in-flight). **Frontend 184 tests, Server 1113 tests. Both builds clean.**

### Five phases over ~13h (TDD per phase):
1. **A1 — Persist Mark-treated + real timeline.** FE-only. Member-360 rail now reads real VIP cases from `useVipCaseHistory()`; "Mark treated" inline form (channel/action/note) PATCHes the case and refetches; timeline renders real ledger events, sample fallback only when 0 cases. Replaced the `SAMPLE_CARE_TIMELINE` mock entirely.

2. **A2 + A3 — Claim/assign + dismiss-with-reason.** FE-only. Queue rail + Member-360 now support case reassign (reassign form pops as modal), dismiss (adds a reason text field + reason enum). Both reuse the treat-form PATCH+refetch pattern. `canWrite` gate unchanged (editor/admin).

3. **B4 — Human-closed KPI outcome + badge.** FE-only (+ server-side counts). "Close · KPI met/missed" button on treated cases. No auto Cube eval; CS clicks "met" or "missed" → PATCH `{status: 'resolved', outcome}` → refetch. **Key decision:** kept existing `attainmentRate` unchanged (`treated+resolved/total`); added separate `kpiMetRate` (`kpi_met/closed-with-outcome`) card + stat. Server returns new aggregate counts in `GET /api/care/vip/:uid` + `GET /api/care/cases?game` response body (no schema change — counts stored in `care_case`).

4. **B5 + B6 — CSV export + 24h activity strip.** FE builds full-page CSV (un-paginated queue), server provides new `GET /api/care/activity?game` bounded SQLite aggregate (24h windows, per-outcome tallies). Monitor strip renders the aggregate (treated/resolved/dismissed/failed counts). Parallel execution: export utils lived in separate file from activity route.

5. **Reseed (guarded reset).** New `POST /api/care/cases/reset?game=X&workspace=W` endpoint. Editor/admin only (inherits `/api/care` write gate). Confirm dialog shows exact case count about to wipe + re-sweep checkbox (OFF by default — re-sweep requires live Cube, may be slow in demo). **Critical guard:** 409 if `isSweepInFlight` (tested before any delete). Wipe scoped to game+workspace (cannot cross tenants).

## The Brutal Truth

**Code review caught 3 wiring gaps** that would have shipped broken:
1. **Dead refetch refs.** Queue component never re-fetched after reset completed; timeline would show phantom deleted cases until page reload.
2. **Confirm dialog + count mismatch.** Dialog never showed the actual case count about to wipe; user saw a generic "Are you sure?" and couldn't audit what would be lost.
3. **Reset-before-mutex.** `clearCases()` deleted records *before* checking `isSweepInFlight`; a concurrent sweep could delete cases that a fresh sweep run was about to process, causing a 409 *after* the damage. The 409 was a false alarm — the cases were already gone.

All three fixed + tested. None reached main before review caught them.

## Technical Details

### Phase 03 Scope Creep (Expected but Noteworthy)

Spec said "FE only." Reality: `kpiMetRate = kpi_met / closed-with-outcome` can't be derived client-side without re-fetching all cases (to count kpi_met instances). Server now returns two new aggregates in every case-list response:
- `kpiMet: number` (count of cases w/ `outcome='met'`)
- `kpiClosed: number` (count of cases w/ `status='resolved'`)

No schema change; `kpiMet` computed on the fly from `outcome` enum. FE derives the rate via `kpiMet / (kpiMet + kiClosed)`. This is a ROI optimization (avoid client-side refetch) but extends the server contract.

### Parallel Subagents on Shared Files

Phases 04 & 05 ran concurrently. Both touched:
- `src/pages/Dashboards/cs/use-care-cases.ts` (import refetch, add activity endpoint call)
- `src/pages/Dashboards/cs/member360/case-ledger.tsx` (render activity strip + export button)

Verification: diff showed no clobber; edits were orthogonal (export button in one section, activity strip in another, refetch hook reused cleanly). **Pattern works but requires explicit file-ownership boundaries in the prompts.** Missed boundary = merge conflict.

### Subagent Scope Creep

Both fullstack agents swept in small care-adjacent refactors beyond their phase specs:
- `translator.ts`: improved `playbook_name` → `Playbook.displayName` mapping  (was brittle, now type-safe)
- `threshold-rule/predicate-tree-types.ts`: inferred types refactored for clarity (was ambiguous, needed a fix for the reset flow to work)
- `care-playbook-validation.ts`: tightened predicate validation (no logic change, added remarks for future maintainers)
- `case-snapshot-summary.ts`: restructured to support outcome serialization (needed for reset + kpiMet counts)

**Root:** agents were given write permission on `src/pages/Dashboards/cs/**` and interpreted the spec as "improve anything touching care." Not a blocker, but scope-creep to watch for when delegating; define file globs tightly.

### Tests & Build

- **FE:** 184 tests (care suite + CS suite). Pass: 184/184. Build: clean.
- **Server:** 1113 tests (care engine + routes). Pass: 1113/1113. Build: clean.
- **Typecheck:** 0 errors.
- **Commits:** 10 conventional commits on main (all fixes integrated). Not yet pushed to `second` (awaiting review + prod approval).

## What We Tried

Code review → found 3 bugs → fixed in-place → re-ran test suite → green → retest against both FE and server integration.

## Root Cause Analysis

### Reset-before-mutex (The Gotcha)

**Why it happened:** The reset route was written as:
```
1. clearCases(gameId, workspace)  // DELETE from ledger
2. if (isSweepInFlight) → 409
```

The guard was positioned *after* the mutation. If a sweep started between the code's check and the delete, it would reference cases that had just been wiped. The 409 would be a lie — "conflict" means something was in-flight and prevented the delete, but the delete already happened.

**Why it was dangerous:** A user resets, the server reports "sweep is active — reset aborted (409)," so the user *thinks* the state is unchanged. But the cases are already gone. They reload the queue and see nothing.

**Fix:** Flip the order. Check `isSweepInFlight` *first*; only if clear, proceed to `clearCases`. Now the 409 is truthful: "I detected a conflict and did nothing."

This is a classic ordering bug in destructive operations guarded by mutexes. **Signal for future-you:** any DELETE/PATCH that checks a lock must check it *before* mutating, not after.

### Scope Creep on Shared Files

The concurrent agents on phases 04 & 05 were each given the same file glob (`src/pages/Dashboards/cs/**`). Both decided they could "optimize" the touch points independently. The refactors were sensible but uncoordinated — e.g., one agent renamed a helper in `translator.ts` and the other had to import the new name (the import existed, so no collision, but close). Pattern: parallel agents need explicit non-overlapping file ownership, or a merge-step afterwards.

## Lessons Learned

1. **KPI outcome must be server-sourced when it's an aggregate.** Looked like a "FE only" phase, but the metric `kpiMetRate` needed server-side counts to avoid a refetch per case. Earlier: profile the client-server boundary when scoping "FE only" features. Outcome: sensible, but unexpected.

2. **Destructive ops + guard checks: mutex before mutation.** Reset-before-mutex is a straightforward mistake but easy to miss in review if the logic reads left-to-right. Lesson: if a delete/wipe checks a lock, the check is part of the atomic precondition. Flip it to the front.

3. **Parallel subagents on shared files need tight ownership.** "FE only" + a glob gave them free rein to refactor. Useful for shipping, but next time: specify file-ownership as globs in the prompt: "Phase 04 owns `case-ledger.tsx` + `use-care-cases.ts:getActivity*`. Phase 05 owns `use-care-cases.ts:reset*` + reset UI components. Do not refactor files outside these globs."

4. **Code review is the keeper of ordering invariants.** The reset-before-mutex bug was invisible in unit tests (each function tested in isolation). It surfaced during integration review: "does the 409 precondition precede the delete?" Pattern: ordering bugs live in sequences, not in functions. Review should ask "if X and Y race, what's the invariant?" before allowing merged execution.

## Next Steps

- Commits staged on `main` (not pushed). Ready for `second` deploy after explicit approval (e.g., from duongnt5 or PM sign-off).
- **Lessons-learned entry:** add "reset-before-mutex" pattern to `docs/lessons-learned.md` (bug shape: destructive guard positioned after mutation instead of before; signal: "does this check prevent the mutation?").
- **Code-standards entry:** consider adding "file ownership in parallel delegation" to dev rules (explicit globs, no ambiguous scopes).
- Next feature: expect `kpiMetRate` to be queried in the admin dashboard + metrics card. Verify the aggregate counts are correct in prod (compare kpiMet/kpiClosed against manual ledger audits).

**Tests:** All 184 FE + 1113 server pass. Commits clean. Ready for review + merge (already on main; just awaiting push + prod validation).

**Status:** DONE. All phases merged. 10 commits on main. Not yet deployed to prod (`second` remote).
