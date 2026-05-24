# Metric Catalog Expansion — close doc-vs-registry gap

**Source-of-truth doc:** `plans/reports/_GDS__-_1_8_Metrics_Definition.md` (53 metrics).
**Current registry:** `server/src/presets/business-metrics/*.yml` (25 files).
**Ballistar measures referenced for grounding:** `cube-dev/cube/model/cubes/ballistar/{mf_users,active_daily,recharge,user_recharge_daily}.yml`.

## Problem

- `/catalog/metric/ltv` 404s — only `ltv_30` is registered. Same shape risk for `roas`, `rr`, `rp` (parameterized families).
- Doc has 53 metrics; registry has 25. Roughly half are not represented.

## Scope (YAGNI — concrete adds only)

### New metric yamls (24 non-parameterized)

| id | label | doc# | formula sketch |
|---|---|---|---|
| impressions | Impressions | 2 | measure: mf_users.impressions |
| clicks | Clicks | 3 | measure: mf_users.clicks |
| ctr | CTR | 4 | ratio: clicks / impressions |
| paid_installs | Paid installs | 6 | measure: mf_users.paid_installs |
| organic_installs | Organic installs | 7 | measure: mf_users.organic_installs |
| cti | Click-to-install rate | 8 | ratio: installs / clicks |
| cpn | Cost per NRU | 10 | ratio: marketing_cost / new_users |
| nru_install_rate | NRU / Install rate | 12 | ratio: new_users / installs |
| rev_npu | Revenue from NPU | 26 | measure: mf_users.rev_new_paying_users |
| arpnpu | ARP per NPU | 27 | ratio: rev_npu / npu |
| nnpu | New register & new paying | 28 | measure: mf_users.new_register_and_paying_users |
| rev_nnpu | Revenue from NNPU | 29 | measure: mf_users.rev_nnpu |
| arpnnpu | ARP per NNPU | 30 | ratio: rev_nnpu / nnpu |
| mkt_rev_ratio | MKT/Rev | 40 | ratio: marketing_cost / revenue |
| acu | Avg concurrent users | 50 | measure: mf_users.acu |
| lcu | Lowest concurrent users | 52 | measure: mf_users.lcu |
| new_role | New role | 41 | measure: mf_users.new_role |
| active_role | Active role | 42 | measure: mf_users.active_role |
| new_paying_role | New paying role | 43 | measure: mf_users.new_paying_role |
| paying_role | Paying role | 44 | measure: mf_users.paying_role |
| trailing_wau | Trailing WAU | 45 | measure: mf_users.trailing_wau |
| trailing_wpu | Trailing WPU | 46 | measure: mf_users.trailing_wpu |
| trailing_mau | Trailing MAU | 47 | measure: mf_users.trailing_mau |
| trailing_mpu | Trailing MPU | 48 | measure: mf_users.trailing_mpu |

### Parameterized canonical aliases (4) — closes the `/ltv` 404 pattern

| id | label | doc# | parameter |
|---|---|---|---|
| ltv | Lifetime value (cohort, day n) | 39 | n ∈ {00,01,03,07,14,21,30,60,90,120,150,180}, default 30 |
| roas | ROAS (day n) | 37 | n ∈ {00,01,03,07,14,21,30,60,90,120,150,180}, default 07 |
| rr | New-user retention (day n) | 32 | n ∈ {01,02,03,04,05,06,07,14,21,30,60,90}, default 07 |
| rp | Paying retention (day n) | 34 | n ∈ {01,03,07,14,21,30,60,90}, default 07 |

Each canonical uses `synonyms` to absorb common aliases (`lifetime_value`, `retention`, etc.). Existing concrete `ltv_30`, `roas_07`, `rr01/07/30` stay untouched.

### Fallback UX (one small change)

`metric-detail-page.tsx` — improve the 404 block to show "Did you mean…?" with fuzzy matches by id, label, and synonyms. Same registry, no new endpoint.

## Out of scope

- Fixing existing broken measure refs (`mf_users.dau`, `mf_users.new_users`, … many don't exist in ballistar today). Pre-existing decision; not touched.
- CVR{funnel step} (#53) — funnel-driven, separate concept.
- A(n), PU(n) parameterized families (#13, #16) — large surface, not a current pain.
- Backend code changes — yaml-only adds compile via existing Zod schema.

## Acceptance

- `/catalog/metric/ltv`, `/roas`, `/rr`, `/rp` all resolve to a detail page.
- Catalog Metrics tab shows ≥ 53 entries after server reload.
- All new yamls pass Zod validation (server boot log: `loaded N metric(s); skipped 0`).
- 404 fallback shows up to 5 fuzzy suggestions.
- Existing tests still pass; new test added for 404 → suggestion list.

## Risk

- Measure refs for some new metrics (impressions, marketing_cost, etc.) reference ballistar measures that don't yet exist. **Same pattern as existing registry** — registry is the semantic layer; measure-availability is checked via `game_compatibility.required_cubes`. Trust tier set to `beta` or `draft` where ref is aspirational.
