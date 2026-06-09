# jus_vn playbook ranking silently merged to whole-base when metric is 100% NULL

**Date**: 2026-06-10 11:23 GMT+7
**Severity**: High
**Component**: Cube mart (`user_gameplay_daily.yml`), VIP-care playbook 06/09 (top-leaderboard, major-achievement)
**Status**: Resolved

## What Happened

jus_vn VIP-care playbooks 06 and 09 rank by fighting-power (战力) — supposed to select top-10 and #1 players on an MMO power leaderboard. The mart was implemented, deployed to local, and passed `/load` probe. But the rank query silently returned all 33,543 anchor-day users with `rank=1` instead of exactly 10 and 1. The cohort verdict flipped from unavailable to "available but the cohort is the entire VIP base" — a predicate that looks plausible in the sweep but is functionally broken.

The issue was caught in validation (a `/load` cohort-distribution probe before the materialized sweep) and NOT in a demo. User decision was honored — fighting-power is 100% NULL across every jus table, so the original design was data-invalid. User chose `role_level + LTV tiebreak` instead.

## The Brutal Truth

This was a "too good to be true" pass. The column exists in the schema (`ingame_fighting_power` is in `mf_ingame_roles`). It's exposed in `/meta`. The mart compiles. The probe returns a result. No red flags until you actually *look* at what the rank is. The feeling: built something defensible, shipped it, and then a probe surfaced the catastrophic silent failure 15 minutes later. Could have been a demo disaster — "top-10 users" returning everyone with a happy-face verdict is the exact "predicate silently matches whole population" failure the design doc flagged as a risk, and it happened anyway.

## Technical Details

**Direct verification (Trino):**
```sql
-- On std_ingame_user_active_daily (jus)
SELECT COUNT(*) all_rows, COUNT(ingame_fighting_power) populated FROM std_ingame_user_active_daily;
-- Result: 1,693,841 | 0

-- On mf_users (jus)
SELECT COUNT(*), COUNT(vip_level) FROM mf_users;
-- Result: 866,297 | 0

-- On mf_ingame_roles (jus)
SELECT COUNT(*), COUNT(ingame_fighting_power) FROM mf_ingame_roles;
-- Result: 1,690,024 | 0
```

**Symptom in the mart (before fix):**
```sql
RANK() OVER (ORDER BY ingame_fighting_power DESC NULLS LAST) AS ladder_rank
-- All 33,543 anchor-day rows tied at rank=1 (NULLS LAST pushed them all equal on the NULL)
```

A rank-10 filter then returned all 33,543. The predicate was syntactically valid and the result was non-empty, so it looked available. The whole VIP base became selectable as a playbook cohort.

## What We Tried

1. **First intuition**: fighting-power schema exists, so it should be populated. Verified the column name was correct.
2. **Probe `/load`**: returned a result (rank=1 for everyone). Didn't inspect the rank values, just confirmed non-error.
3. **Realized during sweep validation**: spotted the cohort was the same size as the entire filtered base (18,968 opened, but 33,543 qualified at day N). Checked the rank column — every row was 1.
4. **Direct Trino count**: confirmed 0/1.69M populated in the source table.

## Root Cause Analysis

1. **Design assumption invalidated by data**: the plan assumed fighting-power was a populated leaderboard column on jus. It's not — it's completely empty (may be a future feature, may be unused on this game). The column exists in the schema but contains no data.
2. **Silent failure mode of RANK + NULLs**: `ORDER BY col DESC NULLS LAST` with an all-NULL column pushes every row to the same position (tied at rank 1). This is valid SQL and doesn't error — it just silently makes every record identical on the ranking key. A subsequent `WHERE rank <= 10` then returns all records with rank 1, which is the entire population.
3. **Probe happened before sweep**: we ran a cohort-distribution check via `/load` before the materialized sweep. That probe call fetched the first batch and examined cohort size. If the probe had been skipped (shipped straight to sweep), the demo would have shown "Top 10 leaderboard" returning ~18k users with no warning. The design doc's risk flagged this exact pattern ("check the predicate isn't matching the whole base"), and the probe discipline caught it.

## Lessons Learned

**Rule**: A Cube member appearing in `/meta` and existing in the Trino schema does NOT guarantee the column is populated — it can be 100% NULL. A rank/filter mart built on an all-NULL column fails silently: the RANK over the column ties all rows, and a "top-N" predicate matches the whole base instead of the N rows. No error, no empty result — looks available and runs without issue, making it a dangerous bug to ship undiscovered.

**Signal**: when porting a mart that ranks or filters on a column to a new game, COUNT the column's non-null population before authoring (e.g., `COUNT(col) WHERE col IS NOT NULL > 0` on the target game's source table). Member presence + schema presence is NOT population presence. A probe that checks cohort distribution against expectations (role_level=cap ties 129k but we expected top-10 to be ~10) would catch a whole-base match before the sweep.

**Apply**: before a playbook mart ships, run a `/load` probe that checks (a) cohort-size vs the metric's filtering base (e.g., "top-10 should return ≈10, not the whole 866k base"), and (b) for any percentiles/rankings, spot-check that the top/bottom values are different (rank 1 ≠ rank 2 ≠ rank 3). A probe with those assertions would have caught the 100% NULL column immediately.

## Next Steps

- ✅ **Fixed**: rewrote mart to `RANK() OVER (ORDER BY ingame_max_active_role_level DESC, ingame_total_recharge_value_vnd DESC)` (role-level + LTV tiebreak). Role-level is populated (866k values, but 129k tie at cap 69). With LTV tiebreak: rank-10 = 10, rank-1 = 1, result makes sense.
- ✅ **Validated**: 59/59 care tests pass; live sweep produces sane cohorts (6 available, 1 available, 10 returned, 1 returned).
- ✅ **Documented**: user confirmed the new semantic ("top-N by progression + lifetime spend, not by 战力").
- **Open**: if fighting-power populates upstream later, revisit to rank by 战力 as originally intended (update mart + re-validate).
