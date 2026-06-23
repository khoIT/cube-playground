# PT & Ballistic Hero — Top Campaigns + Estimating Lift Without a Holdout

Date: 2026-06-23 (GMT+7) · Source: `iceberg.pro_apollo`, `game_integration.{ptg,ballistar}` via `scripts/trino-query.mjs`
Context: extends `apollo-campaign-effectiveness-cfm-jus-260623-1608-report.md`

## TL;DR

- **Picks** — PT (661): (1) *"[Gợi nhắc gửi ATM]"* IAM, **10.6M sends** (largest single campaign in the whole bucket, monetization nudge); (2) *PTG Tết 2025 push series* (Feb 8–14, ~6.2M/day × 7, seasonal retention burst). Ballistic (647): (1) *World Boss reminder series* (recurring event push, ~32K/send — the core retention loop); (2) *Weekly promotion "W1–W4 SGMYPH/AS"* (the only Ballistic campaigns with real `gross_amt`).
- **PT uses no promotion engine** (zero rows in `dash_promotion_daily`) → PT outcomes aren't in Apollo; must come from push engagement + downstream `game_integration.ptg` behavior. Ballistic *does* have promotion revenue but small (top promo 254K VND).
- **Yes — lift is estimable without a planned holdout**, via quasi-experimental designs on a point-in-time player snapshot. Both games have per-user data and the notification stream exposes `received / opened / opt-out / delivery-failure`, which gives a **near-random natural control** (delivery failures among the targeted opt-in set).
- **Best design per campaign type:** targeted+recurring (Ballistic) → **propensity-matched DiD** + within-user reminded-vs-not; near-universal blast (PT) → **delivery-failure / opt-out natural control** or **synthetic-control on pre-trend** (no within-game unexposed pool at 10M reach).

---

## 1. The four campaigns

### Play Together (661) — push/IAM, no promotion revenue
| Pick | Campaign | Channel | Sends | When | Why |
|------|----------|---------|------:|------|-----|
| **PT-1** | `[Gợi nhắc gửi ATM] - 200326` | inapp-message | **10,617,004** | 2026-03-20, recurring | Biggest single campaign across *all 58 products*; "send-ATM" = a social gifting/monetization nudge. Max impact. |
| **PT-2** | `PTG TET` push series (0802…1402) | notification-push | ~6.2M × 7 days | 2025-02-08→14 | Coordinated Tết retention burst; clear seasonal hypothesis, multi-day → good lift test bed. |

(Also notable: *"Hướng dẫn nơi câu cá béo"* feature-education IAM, 6.23M.)

### Ballistic Hero-Global (647) — recurring retention push + weekly promo
| Pick | Campaign | Channel | Reach/Rev | When | Why |
|------|----------|---------|-----------|------|-----|
| **BH-1** | `World Boss` reminder series | notification-push | ~32K/send, many instances | weekly, May–Jun 2025 | Signature event-driven retention loop; recurring cadence is ideal for within-user lift. |
| **BH-2** | `W1–W4 SGMYPH / AS` weekly promo | promotion | top `gross_amt` 253,765 VND | May–Jun 2026 | Only Ballistic campaigns with a real revenue outcome → directly measurable conversion. |

Contrast is deliberate: BH-1 = engagement/retention, BH-2 = monetization.

---

## 2. Can we estimate lift without a baseline/holdout? — Yes

No pre-registered control was created, but a **counterfactual can be reconstructed observationally**. The whole game is point-in-time correctness: build covariates and the comparison pool using *only* data with `ds ≤ campaign_start`, never current-state fields that the campaign itself moved.

### What we can pin down (verified available)
- **Exact treated set + timestamp** — `apollo_sdk_notification` (game_id `PTG`/Ballistic) gives per-user `received` / `received-foreground` / `open` / `clicked` / `dismissed` and subscription `opt-in` / `opt-out` + `token_status`, with `event_time`. → point-in-time exposure, no guessing.
- **Per-user outcomes & covariates** — `game_integration.ptg` and `game_integration.ballistar` schemas exist (per-user revenue/activity), so post-campaign revenue/retention and pre-campaign state are queryable for both games.
- **Segment definition** — `apollo_portal_segment.conditionjsontree` stores the targeting rule (filters + thresholds) → lets us recover any cutoff used (enables RDD below).

### Design ladder (most→least rigorous, given our data)

**(A) Natural control from delivery mechanics — strongest, ≈free experiment.**
Among the *intended* (opt-in, targeted) audience, a slice doesn't get exposed for reasons ~independent of the outcome: token expired, device offline, push not rendered → `received` absent / delivery error. Compare **delivered vs not-delivered** within the targeted set (intent-to-treat).
- Use **delivered**, not *opened*, as treatment — openers self-select (more engaged) and bias lift upward.
- `opt-out` users are also "unexposed" but are *self-selected* (less engaged) → a weaker, confounded control; use only as a sensitivity check, not the primary.

**(B) Propensity-score matching (PSM) on the snapshot base — most general.**
Snapshot the player base at `ds = campaign_start − 1`: covariates = tenure, login recency, 30-day spend / RFM tier, level/VIP, recent sessions. Treated = exposed cohort; control pool = active players that day **not** reached by the campaign (or qualified-but-undelivered). Fit `P(exposed | covariates)`, match (or IPTW), then compare post-window revenue/retention. Sample the control pool (e.g. 5–10× treated) — no need to score all 10M PT users.

**(C) Difference-in-Differences (matched DiD) — the workhorse.**
Pre/post revenue & retention, treated vs matched control from (B). Cancels time-invariant gaps + common shocks (patch, holiday). Matched-DiD is the realistic default for BH-1 and the PT IAM.

**(D) Regression discontinuity (RDD) — cleanest when the segment is a threshold.**
If `conditionjsontree` shows a cutoff (e.g. "30d spend ≥ X", "churn score ≥ p"), compare users just above vs just below — locally randomized around the boundary. Best for threshold-defined segments; recover the cutoff from the rule JSON.

**(E) Synthetic control / pre-trend — for near-universal blasts.**
PT-1/PT-2 hit ~6–10M of a base that size → essentially no within-game unexposed control. Build a synthetic counterfactual from pre-campaign trend + comparison units (other regions/titles, or the opt-out/undelivered slice) and measure deviation post-launch. Pair with (A).

### Mapping designs to the four campaigns
| Campaign | Within-game control? | Primary design | Backup |
|----------|----------------------|----------------|--------|
| PT-1 ATM IAM (10.6M) | almost none | (A) delivered-vs-undelivered + (E) pre-trend | opt-out sensitivity |
| PT-2 Tết push (6.2M×7) | none (everyone) | (E) synthetic/pre-trend; recurring days → within-user | (A) |
| BH-1 World Boss (32K, recurring) | yes (large base) | (B)+(C) matched DiD; **within-user reminded-vs-not** weeks | (A) |
| BH-2 weekly promo (gross_amt) | yes | (B) PSM on participants vs matched non-participants | (D) if segment has a cutoff |

### Snapshot-sampling recipe (the literal "sample the base at run-time")
1. Fix `T0 = campaign_start`. Pull treated uids + exposure ts from `sdk_notification`.
2. Build covariate snapshot from `game_integration.{game}` daily facts filtered `ds < T0` (+ `std_past_segment` ds-dated membership). **No fields mutated after T0.**
3. Draw the comparison pool: random sample of active-at-T0 users not exposed (size ≈ 5–10× treated).
4. Match (PSM/IPTW) → estimate ATT on `[T0, T0+14d]` revenue & `D7/D30` return via DiD.
5. Robustness: vary window, swap delivered↔opened treatment, add opt-out placebo, check pre-trend parallelism.

---

## 3. Caveats (why any single number is soft)
- **Exposure ≠ open ≠ effect** — anchor on *delivered* (ITT); opened-only inflates lift.
- **Self-selection** — opt-in/opt-out is not random; PSM/DiD reduce but don't erase it.
- **Seasonality/novelty** — PT-2 is Tết: lift is entangled with the holiday; synthetic control / pre-trend is mandatory there, not optional.
- **Spillover** — PT is a social game; treated friends influence controls → violates SUTVA, biases lift toward zero (conservative).
- **`gross_amt` = engagement spend**, likely funded from prior recharge — measures activity-shifted spend, not guaranteed incremental cash.
- **Campaign→event attribution** — PT push events carry the campaign only in nested `notification_data.apo_campaign_id` (top-level `campaign_id` ≈ null); the treated-set join must use the nested field.

---

## Unresolved questions
1. **Snapshot grain for PT/Ballistic** — which `game_integration.{ptg,ballistar}` tables carry per-user *daily* revenue/activity (vs current-state only)? Needed for point-in-time covariates; not yet enumerated.
2. **Nested campaign attribution at scale** — extracting `notification_data.apo_campaign_id` over PTG's 47M+ `received` rows is heavy; feasible with date+game pruning but cost untested.
3. **Segment-rule recovery** — can we reliably parse `conditionjsontree` to detect a numeric cutoff (enables RDD), or are most segments multi-clause non-threshold?
4. **Did any campaign already hold back a %?** — some platforms auto-suppress a control slice; if Apollo logs a suppressed/holdout group, that beats all observational designs. Unconfirmed.
5. **PT promotion outcomes** — PT shows zero `dash_promotion_daily`; is PT monetization tracked in a different bucket (`promotion_ptg` schema exists in `iceberg`) we should point at instead?
