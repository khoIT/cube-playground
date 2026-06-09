# Care Playbook Cohort Collapse — why 01/02/07/18 share identical numbers

**Date:** 2026-06-09 13:52 (GMT+7) · **Game:** cfm_vn (also reproduced on ballistar) · **Scope:** analysis + recommendation (no code changed)

## TL;DR

The per-playbook "number" on CS Monitor = count of open `care_cases` for that playbook. For cfm_vn the **total VIP population is 7,814**. Playbooks **01, 02, 07, 18 each have exactly 7,814** cases — i.e. they matched *every* VIP. Playbook 14 matched 1,948 (realistic). The four collapse to the full cohort via **two different mechanisms**, neither of which is "the predicate is too loose by a tunable amount":

| PB | Name | Window / rule | cohort | Mechanism |
|----|------|---------------|--------|-----------|
| 01 | First deposit | `event` first_recharge_date `"last 24 hours"` | 7814 | window string unsupported → filter dropped → full cohort |
| 07 | Rare item acquired | `event` etl_prop_flow.acquired_at `"last 24 hours"` | 7814 | same — `"last 24 hours"` unsupported |
| 18 | Anniversary | `event` first_active_date `"anniversary"` | 7814 | `"anniversary"` unsupported → filter dropped |
| 02 | VIP tier reached | `tierStep` ltv_total_vnd, lowest band ₫5M | 7814 | real filter, but ₫5M gate is *below* the VIP-membership floor → matches all VIPs (redundant) |
| 14 | Reactivation | `abs` days_since_last_active ≥ 3 | 1948 | **works correctly** — abs threshold discriminates |

Verified: `care_vip_profiles` count = 7814 (cfm_vn), 199 (ballistar); `COUNT(*) = COUNT(DISTINCT uid) = 7814` for each of 01/02/07/18.

## The systemic bug (most important)

`expand-relative-date-range.ts` only understands `today/yesterday/this|last week|month|quarter|year` and `"last N days|weeks|months"`. It does **not** understand:
- `"last 24 hours"` / `"last 48 hours"` (hours unit) — used by 01, 07, 10, 17
- `"anniversary"`, `"birthday"` — used by 18, 21
- `"next N days"` — used by 19, 20

On an unrecognized window it returns `null`. `translator.ts:89-104` then **drops the malformed `inDateRange` filter** (so Cube doesn't 400) and logs a warning. `nodeToCubeFilter` drops the now-empty group, so `treeToCubeFilters` yields an **empty filter array**. The membership sweep then counts `<cube>.count` with no filter → **the entire population**, and opens a case for every VIP.

So the failure mode is **fail-OPEN**: a membership predicate that fails to compile silently selects everyone, rather than failing closed. That's a footgun for *any* event playbook, not just these four — 01/07/18 are simply the ones currently available + swept for cfm_vn. (10/17/19/20/21 would do the same once their data sources are available.)

`02` is a separate, real issue: the `tierStep` gate uses the **lowest** band (₫5M) as the cohort filter, but VIP membership already implies high LTV, so the filter is a no-op in practice.

## Should we adjust the predicates?

Yes — but predicate tuning alone is insufficient. Recommended **layered** fix, in priority order:

### 1. Fail-closed in the sweep (systemic — highest value)
A `membership` playbook whose predicate compiles to an **empty** Cube filter must be **skipped** (e.g. `skipped: 'no-predicate'`), never swept as "match all". This single change stops every current and future event playbook from silently opening a case per VIP. Low risk, high blast-radius protection.

### 2. Extend the relative-window vocabulary
Add to `expand-relative-date-range.ts`:
- `"last N hours"` → so `"last 24 hours"`/`"last 48 hours"` resolve (or normalize 01/07/10/17 to `"last 1 day"`/`"last 2 days"`, which already work).
- `"anniversary"` / `"birthday"` — these are **day-of-year recurrence**, not a relative range; they need a different evaluation (match where MONTH/DAY of the member = today). Likely a new rule kind (`recurring`) rather than `inDateRange`. Until built, 18/21 should be **opsDriven/partial** (render, never auto-sweep).
- `"next N days"` (19/20 ops-driven, forward-looking) — also not a "last" range; treat as opsDriven/partial.

### 3. Make 02's gate non-redundant
Re-point the `tierStep` cohort gate to a **meaningful** band (e.g. the ₫20M/₫50M tier, or — more correct — "crossed a band in the last N days", which is an event, not a static ≥ gate). As-is it just re-selects the VIP base.

### Data caveat
Even after predicates compile correctly, the **local seed cube** may not carry realistic distributions for `first_recharge_date`, `acquired_at`, etc., so cohort sizes could still look off locally. The numbers will only be truly realistic against a calibrated/live workspace (no `care-calibration.cfm_vn.json` exists today → nothing is calibrated).

## Suggested sequencing
- Phase A (safe, no threshold decisions): fail-closed skip on empty predicate (#1) + add `"last N hours"` support (#2a). Immediately fixes 01/07 and stops 10/17 regressing.
- Phase B (needs product sign-off — touches thresholds/semantics): 02 gate band (#3), `recurring`/opsDriven handling for 18/21/19/20 (#2b/#2c).

## Unresolved questions
1. Were these 7,814-row sets produced by a **live sweep** against the local cube, or back-filled by a seed generator? `care_sweep_playbook_results` is empty, yet `care_cases` is populated — confirm the generation path so we know whether fixing the sweep alone clears the demo data or a re-seed is needed.
2. For 02 "VIP tier reached": should the cohort be "currently in tier ≥ X" (static) or "crossed into a new tier recently" (event)? This is a product definition, not a code choice.
3. Anniversary/birthday (18/21): keep as auto-sweep once a `recurring` rule lands, or leave as ops-driven manual campaigns?
