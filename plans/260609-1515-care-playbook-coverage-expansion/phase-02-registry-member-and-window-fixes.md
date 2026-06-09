# Phase 02 — Registry member-name + window fixes

**Priority:** P0 (cheap wins) · **Status:** ☐ not started

## Overview
Pure `playbook-registry.ts` edits — no new data model. Fix the member-name mismatches that make data-present playbooks read `unavailable`, and make the anniversary window expandable so 18 actually sweeps.

## Key insight
The availability resolver compares `dataRequirements` against live `/meta` member names **exactly**. cfm_vn has `user_recharge_daily.log_date` and `active_daily.log_date` — the registry asks for non-existent `recharge_date` / `active_date`. And `mf_users` has no `birth_date` (21 stays blocked, correct). 18's `window: 'anniversary'` returns null from the expander → fail-closed skip.

## Requirements
- 03/04 `dataRequirements` reference real members (`user_recharge_daily.revenue_vnd`, `user_recharge_daily.log_date`). (Predicate is reworked in Phase 03.)
- 15 references `active_daily.online_time_sec`, `active_daily.log_date`.
- 18 anniversary resolves to a real cohort gate (offset-day match) and produces a cohort.
- No code comment / filename references plan or finding artifacts.

## Architecture / decisions
- **03/04/15:** flip the `recharge_date`→`log_date`, `active_date`→`log_date` names now so availability is correct; the rolling predicate members land in Phase 03 (these stay `trigger` evalMode until then, so they won't sweep yet — that's fine, Phase 03 finishes them).
- **18 anniversary:** add an `anniversary` window to `expandRelativeDateRange` OR handle in the predicate compiler as an OR of exact dates `{30,90,180,365,730}` days before the anchor. Recommended: expander returns a small set the translator emits as an `OR` of `equals`/`inDateRange` day-bounds (anchor-relative). Cohort gate = `mf_users.first_active_date` ∈ those days.
- Keep `birth_date` (21) untouched → remains `blocked`.

## Related code files
- Modify: `server/src/care/playbook-registry.ts` (PB 01 already `last 3 months`; fix 03/04/15 member names; adjust 18 window encoding).
- Modify (if expander route chosen): `server/src/services/expand-relative-date-range.ts` + `server/src/services/translator.ts` (emit anniversary day-set).
- Tests: `test/expand-relative-date-range.test.ts` (anniversary), a registry availability test (assert 03/04/15/18 verdicts against a stub member set).

## Implementation steps
1. Edit `dataRequirements` for 03/04 (`log_date`), 15 (`log_date`).
2. Implement anniversary expansion (anchor-relative day-set) + translator emission; repoint 18's cohort gate to `mf_users.first_active_date` presence + day-set filter.
3. Add availability unit test: given the live cfm_vn member set, 03/04/15 → not-`unavailable` (member-present), 18 → produces filters; 21 → `unavailable`.
4. Hit `/api/care/playbooks?game=cfm_vn`; confirm verdict shifts.

## Todo
- [ ] 03/04/15 member-name fixes
- [ ] anniversary window expansion + 18 cohort gate
- [ ] availability + expander tests
- [ ] live verdict re-check

## Success criteria
- `/api/care/playbooks?game=cfm_vn`: 18 produces a non-empty cohort on a sweep (with Phase 01 anchor); 03/04/15 show member-present (final sweep behavior completed in Phase 03).
- 21 remains `unavailable` (documented, no source).
- Tests pass.

## Risks
- Anniversary day-set could over-match if anchor drift makes "N days ago" land on a dense cohort. Mitigation: keep the {30,90,180,365,730} set; verify cohort sizes in Phase 06.

## Security
None — config/registry only.

## Next
Phase 03 reworks 03/04/15 predicates onto the rolling marts; 18 is fully done here (pending Phase 01 anchor for non-empty cohort).
