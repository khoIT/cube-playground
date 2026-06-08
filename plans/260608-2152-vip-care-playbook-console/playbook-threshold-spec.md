# Playbook Threshold Spec — cfm_vn & jus_vn

How thresholds are set so **real users qualify**: every threshold is either (a) a **percentile of the live cohort** (recompute → guaranteed non-empty, doesn't rot), (b) a **personal-baseline ratio** (self-referential, inherently data-grounded per user), or (c) **game-defined** (pity floor, rank cutoff). Phase 0 runs the calibration query to seed each concrete value.

> ⚠️ Live-data probe was blocked this session (MCP connector dropped, prod-mirror empty). **Starter values below are estimates** — Phase 0 confirms each against the live distribution before go-live. Calibration query column is the source of truth.

## Tier basis (resolved)
Tier is driven by **`ltv_vnd` cumulative bands** (doc's ₫5M/20M/50M/100M), **not** in-game `max_vip_level` — LTV is comparable across cfm_vn and jus_vn, in-game vip_level scales aren't. `max_vip_level` is surfaced in Member-360 as context only. Band values to be confirmed against live populations in Phase-0 calibration.

## VIP cohort base (gates every behavior/churn playbook)
Only actual VIPs enter the program. **Base predicate** (per game):
`payer_tier IN ('whale','dolphin') OR ltv_vnd >= P90(ltv_vnd | is_paying_30d) OR max_vip_level >= V`
- Calibration: `mf_users` → `user_count` grouped by `payer_tier`; pick cutoff yielding a workable cohort (target ~2–5k VIPs/game). Confirm `max_vip_level` band by `user_count` per level.
- Starter: whale = `ltv_vnd >= 50,000,000` (₫50M), dolphin = `ltv_vnd >= 10,000,000`. VIP base = whale ∪ dolphin.

## Availability legend
`✅ available` (members exist, cohort-queryable) · `⚠ partial` (per-member only, or needs event flag / ops input) · `⛔ unavailable` (required member absent → registry greys the row, runs no query).

## NHÓM 1 · Payment

| # | Playbook | Condition (members) | Threshold rule | Starter | Calibration query | cfm | jus |
|---|---|---|---|---|---|---|---|
| 01 | First deposit | `first_recharge_date` within refresh window | event (no threshold) | last 24h | — | ⚠ | ⚠ |
| 02 | VIP tier reached | `ltv_vnd` crosses band; `max_vip_level` | business bands (doc) OR percentile per tier | ₫5M/20M/50M/100M | `user_count` by ltv band → ensure ≥ N/tier | ✅ | ✅ |
| 03 | Spend spike | `user_recharge_daily.revenue_vnd` vs personal 30d daily avg | daily ≥ **3×** personal avg **AND** ≥ abs floor | 3× & ₫10M | P99 of daily `revenue_vnd` among payers | ✅ | ✅ |
| 04 | Spend drop | rolling 7d spend `<` 30% of personal 30d avg | ratio **0.30** (doc); gate baseline ≥ P50 payer | 0.30 | distribution of 7d/30d ratio among payers | ✅ | ✅ |
| 05 | Payment failure | failed-txn count (**absent**) | — | — | — | ⛔ | ⛔ |

## NHÓM 2 · In-game behavior (cfm via Phase-4 mart; jus has no model)

| # | Playbook | Condition (members) | Threshold rule | Starter | Calibration | cfm | jus |
|---|---|---|---|---|---|---|---|
| 06 | Top leaderboard | `ladder_level` / `max_ladder_score` rank | rank ≤ **10** (doc) | top 10 | rank dist per server/season | ✅¹ | ⛔ |
| 07 | Cosmetic unlock | `etl_prop_flow` prop acquire (rare/limited) | prop in curated rare-set list | per-set | rare prop_id list from prop catalog | ✅¹ | ⛔ |
| 08 | Rank drop / loss streak | `ladder_score_delta` drop; match win/loss | drop > **5** ranks /48h OR loss streak > **5** | doc | streak dist from match flow | ✅¹ | ⛔ |
| 09 | Achievement | top-1 ladder / tournament win | rank = 1 / event win flag | top 1 | — (rare event) | ✅¹ | ⛔ |
| 10 | Guild instability | `clan_id` downgrade / lost war | clan rank ↓ OR war loss | event | derive from clan snapshot delta | ⚠¹ | ⛔ |
| 11 | Collector FOMO | `etl_prop_flow` set ownership | owns ≥ **4/5** of limited set, missing last | 4/5 | per limited-set catalog | ✅¹ | ⛔ |
| 12 | Gacha bad-luck | `etl_lottery_shoot.history_draw_cnt`, `result` | draws since SSR ≥ **pity − k** | pity−5 | pity floor per `lottery_box` | ✅¹ | ⛔ |
| 13 | Sentiment | chat keyword scan (**absent**) | — | — | — | ⛔ | ⛔ |

## NHÓM 3 · Churn risk

| # | Playbook | Condition (members) | Threshold rule | Starter | Calibration | cfm | jus |
|---|---|---|---|---|---|---|---|
| 14 | No login ≥N days | `days_since_last_active`, tier-stepped | Diamond ≥3 / Platinum ≥5 / Gold-Silver ≥7 (doc) | 3/5/7 | dist of `days_since_last_active` in VIP base | ✅ | ✅ |
| 15 | Session-time drop | avg session 7d `<` 40% prior-30d avg | ratio **0.40** (doc) | 0.40 | cfm: `active_daily`+`etl_login/logout`; jus: `active_daily.online_time_sec` | ✅ | ✅ |
| 16 | Negative ticket | ticket sentiment/category (**absent**) | — | — | — | ⛔ | ⛔ |
| 17 | Leave / disband guild | `clan_id` → null transition | membership drop event | event | clan snapshot diff | ⚠¹ | ⛔ |

## NHÓM 4 · Time & event

| # | Playbook | Condition (members) | Threshold rule | Starter | Calibration | cfm | jus |
|---|---|---|---|---|---|---|---|
| 18 | Anniversary | `first_active_date` + offset ∈ {30,90,180,365,730} | exact day match (doc) | doc set | — | ✅ | ✅ |
| 19 | Pre-major-patch | ops calendar (manual) | `days_until_patch ≤ 3` | 3 | manual ops input | ⚠ | ⚠ |
| 20 | New faction/server | ops event; `last_server_id` | event flag | event | manual ops input | ⚠ | ⚠ |
| 21 | Birthday | `birth_date` (**absent**) | — | — | — | ⛔ | ⛔ |

¹ cfm NHÓM-2 rows are `unavailable` until the **Phase-4 gameplay-daily mart** lands (raw `etl_*` cubes aren't cohort-queryable); per-member drill-down works earlier. Registry flips them to `available` automatically once mart members appear in `/meta`.

## Tally
- **cfm_vn:** 12 ✅ (6 post-mart) + 5 ⚠ + 4 ⛔.
- **jus_vn:** 6 ✅ + 3 ⚠ + 12 ⛔ (all NHÓM 2 + the 4 universal blocks).

## Calibration procedure (Phase 0 task)
For each `✅`/`⚠` row: run the calibration query against the game's workspace, record the live distribution + chosen cutoff + resulting cohort size in this file's "Starter" column (replace estimate), then assert cohort size > 0 and within a sane band before enabling the playbook. Percentile/ratio rules are stored as the rule (recomputed on refresh), not as frozen numbers, so they self-calibrate as the population shifts.
