# Tier 1 + Tier 2 Metric Types — Detail Sheet

**Date:** 2026-05-17
**Scope:** 8 metric-creation patterns, no SQL required from users.
**Parent:** [`research-260517-metric-creation-types-roadmap.md`](./research-260517-metric-creation-types-roadmap.md)

Per item: questions answered → real examples → Cube formula → wizard UI.

## Wizard-wide change (prereq for 1.3 / 1.4)

Add a **Step 1 mode toggle** — "What are you creating?":

```
●  Measure       (a number you aggregate — today's flow)
○  Dimension     (a property of each row — tier band, time-since)
```

Segment / Conversion / Retention come later (Tier 3). Mode flows downstream:

| Step | Measure mode | Dimension mode |
|---|---|---|
| 2 Operation | 11 existing ops + new templates | Dimension kind (case-band / time-since) |
| 3 Column slots | as today + Window sub-step | Source column + kind-specific editor |
| 4 Filters | as today | N/A (skip) |
| 5 Identity | as today | as today, name templates differ |
| 6 Test run | as today | preview = histogram / band breakdown |

---

# TIER 1 — same Cube primitives, light UX

## 1.1 Conditional measure (count/sum *where*…)

**Questions answered**
- How many paying users do we have?
- How many whales in VN?
- How much revenue came from IAP channel last week?
- How many users hit VIP level 5+?
- How many rows match condition X?

**Real examples** (catalogue + liveops)
- `paying_users`, `paying_users_30d`, `whales_count`, `lapsed_this_month_count` (mf_users.yml)
- `paying_users` filtered (recharge.yml)
- Campaign reads: "users with `lifetime_spend_total > 0` AND `account_age_days <= 14`" (COS-3 entry)

**Cube formula**
```yaml
- name: whales_count
  type: count_distinct
  sql: user_id
  filters:
    - sql: "{CUBE}.ltv_vnd >= 10000000"
```

**UI changes**
- Today, conditional measures require: pick `count_distinct` → click into Step 4 filter tree → build predicate. Two clicks deep, easy to miss.
- **Add a "Where" row** directly on Step 3 column-slot UI (single predicate: `[dim ▾] [op ▾] [value]`). 80% of campaign filters are single-predicate.
- "+ More conditions" link → opens existing Step 4 filter tree.
- Step 5 name template: `{column}_where_{condition_slug}` (e.g., `users_where_paying`).

**Why now:** zero Cube changes, surfaces an existing capability users already need.

---

## 1.2 First-seen / latest-seen timestamp

**Questions answered**
- When did each user last log in?
- When did each user first recharge?
- What's the earliest signup date in cohort X?
- When was the most recent active session?

**Real examples**
- `first_login_date`, `last_login_date`, `first_recharge_date`, `last_recharge_date`, `last_active_date` (mf_users.yml)
- Campaign reads: `last_login_at` (hourly grain — CFM-1, CFM-4, COS-1 etc., used in ~12 retention campaigns)
- `account_first_login_mmdd` (PT-1 anniversary)

**Cube formula**
```yaml
- name: last_login_at
  type: max
  sql: login_time
```

**UI changes**
- Today: users must know to pick `Min` or `Max` and find a time-typed column. Generic Min/Max framing buries the pattern.
- Add **two op-picker cards** in a new "Time" group on Step 2:
  - **First seen** → maps to `min` op, Step 3 column picker filtered to `type: time` only.
  - **Latest seen** → maps to `max` op, same filter.
- Step 5 name auto-suggest: `first_{col}_at` / `last_{col}_at`.
- Result preview (Step 6) renders a date, not a number.

**Why now:** trivial UX, unblocks `last_login_at`-style metrics that the entire retention category reads.

---

## 1.3 Time-since-event dimension

**Questions answered**
- How long since each user installed?
- How many days since last active?
- How many hours since last recharge?
- Bucket users by recency (then pair with Tier-banding 1.4)

**Real examples**
- `days_since_install`, `days_since_last_active`, `days_since_last_recharge` (mf_users.yml)
- Campaign reads: `account_age_days` (~15 campaigns: COS-3 entry, CFM-12 NRU filter, TF-1 NRU filter, CFM-13 NRU optional filter, NTH-9 churn check, etc.)
- `time_since_event` for "30 min since promoted-item-view" (CFM-18 — though this is session-scoped Journey state, not User Stage)

**Cube formula** (dimension, not measure)
```yaml
- name: days_since_last_active
  sql: "DATE_DIFF('day', {CUBE}.last_active_date, CURRENT_DATE)"
  type: number
```

**UI changes** (first dimension-mode item)
- Step 1: pick **Dimension** mode.
- Step 2 dim-kind picker: **Time-since-event**.
- Step 3:
  - Anchor column: dropdown of `type: time` dims (`first_login_date`, `last_active_date`, `last_recharge_date`).
  - Reference: `Current date` (default) / `Specific date` (rare).
  - Unit: `Day` / `Hour` / `Week` / `Month` (radio).
- Step 5 name auto-suggest: `{unit}s_since_{anchor}` → `days_since_last_active`.
- Step 6 preview: histogram of the new dimension across the cube's row sample.

**Why now:** unblocks the activation-clock pattern (Pattern 4 in liveops spec) without touching Cube; pure SQL-templating.

---

## 1.4 Tier-banding `case` dimension

**Questions answered**
- Which tier is each user in (whale / dolphin / minnow / non-payer)?
- What lifecycle stage (active_today / dormant / churned)?
- Which transaction-value band did this charge fall in?
- Which gem-balance tier (drives PT-6/CFM-9 segmentation)?
- Which recharge tier triggers a push?

**Real examples**
- `payer_tier`, `lifecycle_stage` (mf_users.yml), `txn_value_band_vnd` (recharge.yml)
- Campaign reads:
  - `recharge_tier` derived (PT-4 5min-grain push targeting)
  - `tier_banding` custom dim (CFM-9 — `[0,1k] / (1k,10k] / (10k,∞)` gem bands → different drop tables)
  - `payer_tier` for monitoring + segmentation across ~all 47
  - VIP `vip_tier` (PT-6/COS-3)
  - Annual contribution tier `Veteran/Active/Casual/New-this-year` (CFM-11)

**Cube formula**
```yaml
- name: payer_tier
  type: string
  case:
    when:
      - sql: "{CUBE}.ltv_vnd >= 10000000"
        label: whale
      - sql: "{CUBE}.ltv_vnd >= 1000000"
        label: dolphin
      - sql: "{CUBE}.ltv_vnd > 0"
        label: minnow
    else:
      label: non_payer
```

**UI changes**
- Step 1: Dimension mode.
- Step 2 dim-kind: **Tier banding**.
- Step 3 — visual band editor:
  - Source column: any numeric dim (`ltv_vnd`, `account_age_days`, `current_gem_balance`).
  - Vertically-ordered band rows (= SQL `case when` order):
    ```
    [≥ ▾] [10,000,000]   → label [whale]
    [≥ ▾] [1,000,000]    → label [dolphin]
    [>  ▾] [0]           → label [minnow]
    ──────────────────────────────
    Else                 → label [non_payer]
    ```
  - "+ Add band" / drag-reorder / delete-band.
- Inline preview rail: histogram of the source column with colored band overlays + row counts per band. Catches accidental "all users fall into non_payer" mistakes immediately.
- Step 5 name auto-suggest: `{column}_tier` or `{column}_band`.

**Why now:** unlocks Pattern 2 (multi-segment payload branching) downstream; every monetization campaign reads a tier dim.

---

# TIER 2 — Cube primitive exists, new sub-step

## 2.1 Rolling-window measure

**Questions answered**
- Match count over the last 7 days?
- Housing interactions in the trailing 30 days?
- Login count over the last 14 days?
- Friend overlaps today?
- Trailing-30-day revenue?

**Real examples**
- Campaign reads:
  - `match_played_count_last_7d` (hourly — COS-1 Power Player gate, COS-2 Casual seg)
  - `housing_interaction_count_30d` (hourly — NTH-3 eligibility)
  - `friend_session_overlap_count_today` (hourly — PT-2 social mission)
  - `rank_change_velocity` derived from trailing rank deltas (COS-2)
- Catalogue does not currently expose these as measures — must be SQL'd by hand today.

**Cube formula**
```yaml
- name: match_count_last_7d
  type: count
  rolling_window:
    trailing: 7 day
```

With offset for "last week ending yesterday":
```yaml
  rolling_window:
    trailing: 7 day
    offset: end
```

**UI changes**
- Step 2 op picker unchanged.
- **New "Window" sub-step** between Op (Step 2) and Filters (Step 4) — visible only when the chosen op is window-compatible (count, sum, avg, count_distinct):
  ```
  Window: ○ No window (default)   ● Rolling window
    Trailing  [7] [days ▾]
    Ending    [today ▾]            (today / yesterday / start-of-month)
  ```
- Test-run (Step 6) chart MUST show the metric across a multi-week time axis so window-sliding is visually verified (a flat scalar tile is misleading here).
- Step 5 name auto-suggest: `{op}_{column}_last_{N}{unit}` → `count_matches_last_7d`.

**Why now:** ~12 calendar metrics blocked on this; native Cube support; no upstream data dependency.

---

## 2.2 Time-shift / period-over-period

**Questions answered**
- Revenue this month vs last month?
- DAU today vs same weekday last week (WoW)?
- D7 retention this cohort vs prior cohort?
- YoY change in paying users?
- Δ% of new installs vs trailing week?

**Real examples**
- Monitoring rollup (Part B6) — every "vs holdout / WoW / MoM" panel:
  - "D1/3/7/14 by chapter depth" (TF-1)
  - "Daily completion rate target band WoW" (TF-2)
  - "D14 retention of Power Player vs S1 baseline" (COS-1)
  - "Uplift vs holdout" on ARPU, retention, engagement (all 47)
- `mau_prev_month` is hand-rolled today via a filter trick (active_daily.yml:128–133) — replace with `time_shift` once supported.

**Cube formula**
```yaml
- name: revenue_vnd_prev_month
  sql: "{revenue_vnd}"
  type: number
  time_shift:
    - time_dimension: recharge_date
      type: prior
      interval: 1 month
```

Δ% derived measure:
```yaml
- name: revenue_vnd_mom_pct
  sql: "({revenue_vnd} - {revenue_vnd_prev_month}) * 1.0 / NULLIF({revenue_vnd_prev_month}, 0)"
  type: number
  format: percent
```

**UI changes**
- On Step 2, after picking an op, surface a **"Compare to prior period"** toggle:
  ```
  Aggregation: Sum of revenue (VND)
  ☑ Compare to prior period
    Shift  [1] [month ▾] ([prior ▾])
    Generate ☑ Δ value   ☑ Δ %
  ```
- One wizard submission emits **3 sibling measures**: base, `_prev`, `_pct_change`. Step 5 YAML-preview shows all three; identity inputs apply to base, sibling names derived.
- Time dim auto-detected from the source cube — disable toggle if no time dim available, with explanatory tooltip.

**Why now:** powers the monitoring side of every campaign; eliminates hand-rolled `mau_prev_month`-style filter tricks.

---

## 2.3 Cumulative / lifetime measure

**Questions answered**
- Lifetime kill count per user?
- Total login days ever?
- All-time recharge value?
- Total UGC submissions per creator?
- Running sum of match wins?

**Real examples**
- Lifetime stats reused across 5+ campaigns (Pattern 1):
  - `lifetime_headshot_count`, `lifetime_match_count`, `lifetime_kill_count`, `lifetime_revive_count` (CFM-3, CFM-6, CFM-10 storytelling copy)
  - `lifetime_login_days`, `lifetime_recharge_total`, `lifetime_owned_items` (set) — daily-grain, shared via Asset Library
  - `lifetime_ugc_submissions` (NTH-1 post-event tag)
- Catalogue mostly pre-aggregates these in `mf_users` (ltv_vnd, lifetime_txn_count, total_active_days) — but the wizard can't author *new* lifetime stats; users hit a wall when a campaign needs a new one.

**Cube formula** — two patterns:

A) Unbounded rolling window (re-aggregates events at query time):
```yaml
- name: lifetime_match_count
  type: count
  rolling_window:
    trailing: unbounded
```

B) Sum/max over a pre-aggregated `mf_users` column (preferred when upstream supports it — single-column read):
```yaml
- name: lifetime_match_count_total
  sql: ingame_lifetime_match_count
  type: sum    # or `max` for per-user lifetime when grouping by user_id
```

**UI changes**
- Step 2 op picker: add **"All-time total"** / **"Lifetime count"** template cards in the new "Window" group (alongside Rolling-window from 2.1).
- When chosen, Step 3 = column slot only; the window is fixed to `trailing: unbounded`.
- Detection hint: if `mf_users` already has a matching pre-aggregated column, suggest Pattern B with a "Faster — uses pre-aggregated column" badge.
- Step 5 name auto-suggest: `lifetime_{column}` / `total_{column}`.
- Step 6 preview: single scalar tile + sparkline showing growth over the cube's time range (validates the unbounded window).

**Why now:** Pattern 1 (Lifetime-stat interpolation) names this as a *load-bearing* pattern across 5+ storytelling campaigns; today the only path is "ask an analyst to add a column to `mf_users`".

---

## 2.4 Calendar-window aggregation (year / season / month)

**Questions answered**
- Login days **in 2026**?
- Gem spend **this calendar year**?
- Match count **this season**?
- Revenue **this month**?
- Hours played **in 2026**?

**Real examples**
- Annual aggregations (CFM-11 contribution tiering, daily-grain, year-rollover semantics):
  - `login_days_2026`, `rank_achievements_2026`, `gem_spend_2026`, `match_count_2026`, `hours_played_2026`
- Season-bound (COS-1):
  - "Top S5 milestone reveal: `current_oven_crown >= milestone_value`" — milestone is a season-window aggregation
- Spec calls out this as a **real platform gap**: "today's GDS revamp `time_grain` enum is `realtime / 5min / 1hour / 1day` — annual is implementable on top of `1day` aggregations but needs explicit rollover support" (Notes under Category 6).

**Cube formula** — express as filtered aggregation, either:

A) Fixed year (works today, no rollover):
```yaml
- name: login_days_2026
  type: count_distinct
  sql: log_date
  filters:
    - sql: "EXTRACT(YEAR FROM {CUBE}.log_date) = 2026"
```

B) Rolling current year (needs Cube `rolling_window` aligned to `year`, or compiler-substituted current-year filter):
```yaml
- name: login_days_current_year
  type: count_distinct
  sql: log_date
  filters:
    - sql: "EXTRACT(YEAR FROM {CUBE}.log_date) = EXTRACT(YEAR FROM CURRENT_DATE)"
```

**UI changes**
- Reuses the Window sub-step from 2.1, with a **second window mode**:
  ```
  Window: ○ No window   ○ Rolling window   ● Calendar window
    Bound:    [Current ▾] [year ▾]      (current / specific / custom range)
    Anchor:   [today ▾]
  ```
- "Current year" choice surfaces a callout: *"This metric resets on Jan 1 — see year-rollover notes."* Defends against the gap in upstream support.
- "Specific year" → free-form integer (`2026`) → emits the fixed-year filter pattern A.
- "Custom range" → calendar date pickers (start, end) — useful for seasons (e.g., S5 = Aug 1–Oct 31).
- Step 5 name auto-suggest: `{column}_{year}` or `{column}_this_year` / `{column}_s5`.

**Why now:** CFM-11 + NTH-10 + PT-11 (Q4 contribution-tiering — the year-end wave) are all blocked on this. Pattern A is buildable today with the proposed filter UI; Pattern B is the explicit follow-up once year-rollover support lands upstream.

---

# Coverage summary (Tier 1 + Tier 2 only)

| # | Type | Cube primitive | Calendar metrics unblocked (est.) | Wizard delta |
|---|---|---|---|---|
| 1.1 | Conditional measure | filters: on measure | ~15 | Step 3 "Where" row |
| 1.2 | First/last timestamp | min/max on time dim | ~10 | Step 2 "Time" group |
| 1.3 | Time-since dimension | DATE_DIFF dim | ~8 | Step 1 mode + Step 2 dim kind |
| 1.4 | Tier-banding dimension | case dim | ~6 (+ enables multi-segment branching) | Visual band editor |
| 2.1 | Rolling window | rolling_window | ~12 | Window sub-step |
| 2.2 | Time-shift | time_shift | ~all monitoring panels | "Compare to" toggle |
| 2.3 | Lifetime / cumulative | unbounded rolling OR mf_users column | ~14 | Op cards in Window group |
| 2.4 | Calendar window | filter on time-fn OR rolling-year | ~6 (Q4 contribution tier) | Window sub-step, calendar mode |

**Total unblocked: ~71 distinct metric definitions** in the 2026 calendar (some shared across campaigns), built **without users writing SQL**.

# Suggested implementation order

1. **1.1 + 1.2** — pure UX promotion, no Cube changes, no new modes. Quickest visible win.
2. **1.3 + 1.4** — introduces Dimension mode (the bigger architectural step). Once done, downstream tier-banding is everywhere.
3. **2.1 + 2.3** — Window sub-step lands rolling + lifetime together (they share the same UI surface).
4. **2.2** — Compare-to toggle, decoupled from Window sub-step.
5. **2.4** — Calendar mode within the Window sub-step, after 2.1's foundation is in place. Year-rollover semantics flagged with the callout pattern.

# Unresolved questions

- **Dimension mode persistence:** today's wizard writes to the cube's `measures:` block. Dimensions need a separate write path to `dimensions:`. Is the same YAML file safe to append both, or do we need a dimension-overlay file (parallel to the measure-overlay pattern)?
- **Window sub-step gating:** which ops are window-compatible? `count`, `count_distinct`, `sum`, `avg` clearly are; `min` / `max` are debatable for rolling but fine for cumulative; `median` / `percentile` over a rolling window are expensive — should we hide the window option for these or warn?
- **2.2 sibling-measure naming:** auto-generated `_prev` and `_pct_change` siblings — do they share the parent's `meta.author / created_at`, or get their own? Affects audit trail.
- **2.4 calendar-anchor:** for "Current year", does the metric query against `EXTRACT(YEAR FROM CURRENT_DATE)` at query time (always live) or against a baked-in `2026` at build time (deterministic but needs manual rebuild Jan 1)? Recommend live-eval with a kill-switch.
- **1.4 band-editor with non-numeric source:** should the editor support string-based bands too (e.g., `country IN ('VN','TH') → SEA`)? Today's `case` syntax allows it; UX gets messier (no histogram preview). Defer to a v2.
