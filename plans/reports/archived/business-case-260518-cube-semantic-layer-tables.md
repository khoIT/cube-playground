# Cube Semantic Layer — Business Case for Game Ops & Liveops Data Products

## Why this matters now

We already have two systems that consume metrics, and both have the same scaling problem: **every new metric is bespoke work.**

- **MCP tool** surfaces queries to agents, but each endpoint is hand-written. Adding a new metric means writing a new tool and shipping a build.
- **CDP** serves metrics in real time per `MM-01-CRUD.openapi`, but creates **one metric at a time** — each one is a manual CRUD entry with the SQL re-encoded by hand.

So every campaign metric ends up implemented three times (dashboard, MCP, CDP), drifts in the meeting room, and grows the engineering bill linearly. A semantic layer makes the metric definition the single source artifact, and every downstream system a mechanical projection of it.

Section 1 walks through 13 questions ranked by complexity. Each question is presented as a 3-column row:

- **Column 1** — the business problem.
- **Column 2** — what would have to be built **without** a semantic layer (raw SQL, the CDP metric records that would need to be CRUD'd, and the operational pain).
- **Column 3** — how Cube handles it today, with the exact YAML to write and the exact query to issue.

The tier badge (T1 → T4) doubles as a phasing plan. T1 rows ship immediately on existing YAML; T4 rows need warehouse-view collaboration with data eng.

---

## Section 1 — Business questions × build-from-scratch cost × Cube YAML

---

### 1 · T1 · "How many paying users do we have in Vietnam right now?"

**Column 1 — Business question.** A liveops manager prepping tomorrow's IAP-shop push needs the number of current paying users in Vietnam — and needs it to match finance's definition of "paying."

**Column 2 — If we built this without a semantic layer.**

Raw SQL each consumer would write against the warehouse:
```sql
SELECT COUNT(DISTINCT user_id) AS paying_users_vn
FROM mf_users
WHERE unified_first_country_code = 'VN'
  AND ingame_total_recharge_value_vnd > 0;
```

CDP metric records that would need to be CRUD'd one-at-a-time:
- `paying_users_vn` — VN only, lifetime
- `paying_users_th`, `paying_users_id`, `paying_users_ph`, `paying_users_my` — one per country (N)
- `paying_users_total` — same SQL minus the country filter
- `paying_users_vn_30d`, `paying_users_th_30d`, … — N more records for the rolling 30-day variant
- `paying_users_vn_whales`, `paying_users_vn_dolphins`, … — N×M records when tier overlay is needed

Why this hurts without a semantic layer:
- **Combinatorial explosion.** 5 countries × 3 windows × 4 tiers = **60 CDP records** that all duplicate the same `> 0` threshold logic.
- **Definition drift.** When finance decides "paying" means `> 10,000 VND` (to exclude test charges), all 60 records and N MCP endpoints must update synchronously — or numbers in tomorrow's meeting will disagree.
- **No audit trail.** Which dashboard uses which definition? The SQL lives inside CRUD rows; no compiler can grep it.

**Column 3 — How Cube handles it (full YAML).**

Already in `mf_users`:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    dimensions:
      - name: country
        sql: unified_first_country_code
        type: string
    measures:
      - name: paying_users
        type: count_distinct
        sql: user_id
        filters:
          - sql: "{CUBE}.ingame_total_recharge_value_vnd > 0"
    segments:
      - name: vn_users
        sql: "{CUBE}.unified_first_country_code = 'VN'"
```

Query against Cube:
```json
{
  "measures": ["mf_users.paying_users"],
  "segments": ["mf_users.vn_users"]
}
```

Same `paying_users` measure answers every (country × tier × window) combo by swapping the segment. Change the threshold → one YAML line → all 60 hypothetical combinations follow automatically. CDP stops needing 60 records; it needs one *pointer* to the measure name.

---

### 2 · T1 · "Total revenue this month, split by IAP vs Web payment channel"

**Column 1 — Business question.** Finance asks for current-month revenue split by payment channel for the monthly board deck. Marketing wants the same number but for the last 28 days. Game ops wants today only.

**Column 2 — If we built this without a semantic layer.**

Raw SQL:
```sql
SELECT
  CASE WHEN payment_channel IN ('IAP_GOOGLE','IAP_APPLE','IAP') THEN 'IAP' ELSE 'Web' END AS channel,
  SUM(charged_value) AS revenue_vnd
FROM etl_ingame_recharge
WHERE recharge_time >= DATE_TRUNC('month', CURRENT_DATE)
  AND recharge_time <  DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1' MONTH
GROUP BY 1;
```

CDP metric records needed:
- `revenue_this_month_iap`, `revenue_this_month_web`, `revenue_this_month_total` — current month, three channels
- `revenue_last_month_iap`, `revenue_last_month_web`, `revenue_last_month_total` — last month, three channels (for the deck's comparison)
- `revenue_28d_iap`, `revenue_28d_web` — marketing's rolling 28d
- `revenue_today_iap`, `revenue_today_web` — ops view
- Same again sliced by country, OS platform, acquisition channel — **multiplies by every dimension consumers care about**

Why this hurts:
- The "IAP vs Web" mapping logic is hard-coded in the CASE. If a new payment provider arrives (`IAP_HUAWEI`), you must update every CDP record that classifies channels.
- Every time window is a separate record. There's no `time_dimension` concept — CDP serves point values, not parameterized windows.
- Choosing the right source table (raw events vs the day-grain rollup `std_ingame_user_recharge_daily`) is a manual perf decision encoded inside each CDP SQL string.

**Column 3 — How Cube handles it (full YAML).**

The `recharge` cube already exposes everything:
```yaml
cubes:
  - name: recharge
    sql_table: etl_ingame_recharge
    dimensions:
      - name: payment_channel
        sql: payment_channel
        type: string
      - name: recharge_time
        sql: recharge_time
        type: time
    measures:
      - name: revenue_vnd
        sql: charged_value
        type: sum
    segments:
      - name: iap
        sql: "{CUBE}.payment_channel IN ('IAP_GOOGLE','IAP_APPLE','IAP')"
      - name: web
        sql: "{CUBE}.payment_channel NOT IN ('IAP_GOOGLE','IAP_APPLE','IAP')"
```

Query for current month split by channel:
```json
{
  "measures": ["recharge.revenue_vnd"],
  "timeDimensions": [{
    "dimension": "recharge.recharge_time",
    "dateRange": "this month",
    "granularity": "month"
  }],
  "dimensions": ["recharge.payment_channel"]
}
```

Or use the iap/web segments directly:
```json
{
  "measures": ["recharge.revenue_vnd"],
  "segments": ["recharge.iap"],
  "timeDimensions": [{ "dimension": "recharge.recharge_time", "dateRange": "this month" }]
}
```

For the day-grain (faster on big windows), point at `user_recharge_daily.revenue_vnd_total` instead — same query shape. Add a new payment provider? Edit one segment definition.

---

### 3 · T1 · "Top 5 acquisition channels by 30-day LTV"

**Column 1 — Business question.** Marketing wants to know which acquisition channels drive the most revenue in the first 30 days of a user's life, ranked top-5.

**Column 2 — If we built this without a semantic layer.**

Raw SQL:
```sql
SELECT media_source,
       SUM(ingame_total_recharge_value_vnd_30d) AS ltv_30d_vnd
FROM mf_users
GROUP BY media_source
ORDER BY ltv_30d_vnd DESC
LIMIT 5;
```

CDP metric records needed:
- `ltv_30d_total_by_channel_<channel>` — one per media_source value (`facebook`, `google`, `tiktok`, `applovin`, …)
- `ltv_30d_total_by_country_<country>` — one per country (if marketing also wants this cut)
- `ltv_30d_total_by_campaign_<campaign_id>` — exploded per campaign ID (thousands)
- … and the same SQL re-encoded inside each record

Why this hurts:
- Every new dimension consumers want to slice by means **another N records**. CDP grows as `O(dimensions × values)`.
- Sorting and limit can't be pushed into CDP (each record returns one value). The consumer has to fetch all N records and rank client-side.
- `ingame_total_recharge_value_vnd_30d` is the pre-aggregated 30-day column already sitting in `mf_users`. Without a semantic layer there's no central place that says "use this column for 30d revenue questions" — analysts repeatedly write the slower `SUM(charged_value) WHERE recharge_time >= ...` against raw events.

**Column 3 — How Cube handles it (full YAML).**

Already in `mf_users`:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    dimensions:
      - name: media_source
        sql: media_source
        type: string
      - name: campaign_id
        sql: campaign_id
        type: string
      - name: ltv_30d_vnd
        sql: ingame_total_recharge_value_vnd_30d
        type: number
        description: Rolling 30-day recharge value (pre-aggregated in mf_users)
    measures:
      - name: ltv_30d_total_vnd
        sql: ingame_total_recharge_value_vnd_30d
        type: sum
        description: Sum of pre-aggregated 30d LTV across users
```

Query:
```json
{
  "measures": ["mf_users.ltv_30d_total_vnd"],
  "dimensions": ["mf_users.media_source"],
  "order": { "mf_users.ltv_30d_total_vnd": "desc" },
  "limit": 5
}
```

Want the same ranking by country? Just swap the dimension — no new YAML, no new CDP record. By campaign? Same. CDP, if pointed at `/v1/load` with the measure name, serves all of these from one registration.

---

### 4 · T1 · "ARPPU broken down by payer tier (whale / dolphin / minnow) × country"

**Column 1 — Business question.** Product asks: how much do whales actually spend on average, vs dolphins and minnows, across our top markets? Drives pricing-tier and IAP-shop design.

**Column 2 — If we built this without a semantic layer.**

Raw SQL:
```sql
WITH tiered AS (
  SELECT
    user_id,
    unified_first_country_code AS country,
    ingame_total_recharge_value_vnd AS ltv_vnd,
    CASE
      WHEN ingame_total_recharge_value_vnd >= 10000000 THEN 'whale'
      WHEN ingame_total_recharge_value_vnd >= 1000000  THEN 'dolphin'
      WHEN ingame_total_recharge_value_vnd > 0         THEN 'minnow'
      ELSE 'non_payer'
    END AS payer_tier
  FROM mf_users
)
SELECT country, payer_tier,
       SUM(ltv_vnd) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN ltv_vnd > 0 THEN user_id END), 0) AS arppu_vnd
FROM tiered
WHERE payer_tier <> 'non_payer'
GROUP BY country, payer_tier;
```

CDP metric records needed:
- `arppu_whales_vn`, `arppu_dolphins_vn`, `arppu_minnows_vn` — VN × 3 tiers
- × 5 countries = **15 records** for the lifetime view
- × 3 windows (lifetime, 30d, 7d) = **45 records** total
- The CASE-WHEN thresholds (`10000000`, `1000000`) live in 45 separate SQL strings

Why this hurts:
- **Threshold drift.** When the team raises the whale cutoff to 20M VND, all 45 records must be edited in lockstep. Miss one → quietly wrong dashboard.
- **Compositional reuse impossible.** "ARPPU for paying users in lifecycle stage `dormant`" is yet another new record from scratch — not a composition of existing ones.
- **No reuse of the `payer_tier` concept** by other metrics (segments, drill-downs, retention curves) — each consumer re-derives it.

**Column 3 — How Cube handles it (full YAML).**

Already in `mf_users`:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    dimensions:
      - name: country
        sql: unified_first_country_code
        type: string
      - name: payer_tier
        type: string
        case:
          when:
            - sql: "{CUBE}.ingame_total_recharge_value_vnd >= 10000000"
              label: whale
            - sql: "{CUBE}.ingame_total_recharge_value_vnd >= 1000000"
              label: dolphin
            - sql: "{CUBE}.ingame_total_recharge_value_vnd > 0"
              label: minnow
          else:
            label: non_payer
    measures:
      - name: paying_users
        type: count_distinct
        sql: user_id
        filters:
          - sql: "{CUBE}.ingame_total_recharge_value_vnd > 0"
      - name: ltv_total_vnd
        sql: ingame_total_recharge_value_vnd
        type: sum
      - name: arppu_vnd
        sql: "{ltv_total_vnd} * 1.0 / NULLIF({paying_users}, 0)"
        type: number
        description: Average revenue per paying user (lifetime)
```

Query:
```json
{
  "measures": ["mf_users.arppu_vnd"],
  "dimensions": ["mf_users.country", "mf_users.payer_tier"]
}
```

Raise the whale cutoff to 20M? Change `10000000` to `20000000` in one place — every dashboard, every CDP audience, every MCP tool follows.

---

### 5 · T2 · "Revenue this month vs last month, per OS platform"

**Column 1 — Business question.** Executive standup wants a single chart showing this-month-to-date revenue alongside same-period-last-month, sliced by iOS vs Android, to spot platform-specific drops fast.

**Column 2 — If we built this without a semantic layer.**

Raw SQL — typically two queries pivoted client-side:
```sql
-- current month
SELECT ingame_last_recharge_os_platform AS os,
       SUM(ingame_total_recharge_value_vnd) AS revenue_current_month
FROM std_ingame_user_recharge_daily
WHERE log_date >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY 1;

-- last month, same MTD window
SELECT ingame_last_recharge_os_platform AS os,
       SUM(ingame_total_recharge_value_vnd) AS revenue_last_month
FROM std_ingame_user_recharge_daily
WHERE log_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1' MONTH
  AND log_date <  DATE_TRUNC('month', CURRENT_DATE)
  AND log_date <  DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1' MONTH
                  + (CURRENT_DATE - DATE_TRUNC('month', CURRENT_DATE))
GROUP BY 1;
```

CDP metric records needed:
- `revenue_mtd_ios`, `revenue_mtd_android`, `revenue_mtd_total`
- `revenue_last_month_mtd_ios`, `revenue_last_month_mtd_android`, `revenue_last_month_mtd_total`
- Repeat for prior-week, prior-quarter, prior-year comparisons that other consumers will ask for
- Repeat per country, per acquisition channel, per payer tier — **N consumers × M comparisons × K slices**

Why this hurts:
- **Time-shift logic is duplicated.** Every "vs prior period" metric re-derives the same date arithmetic. A timezone bug → bug in dozens of records.
- **The MTD alignment** (only compare last month *up to* today's day-of-month) is the part that gets wrong most often — and every CDP record stores its own copy.

**Column 3 — How Cube handles it (full YAML).**

Add a time-shifted companion to `user_recharge_daily`:
```yaml
cubes:
  - name: user_recharge_daily
    sql_table: std_ingame_user_recharge_daily
    dimensions:
      - name: os_platform
        sql: ingame_last_recharge_os_platform
        type: string
      - name: log_date
        sql: "from_iso8601_timestamp(CAST({CUBE}.log_date AS VARCHAR) || 'T00:00:00Z')"
        type: time
    measures:
      - name: revenue_vnd_total
        sql: ingame_total_recharge_value_vnd
        type: sum
      - name: revenue_vnd_prev_month
        sql: ingame_total_recharge_value_vnd
        type: sum
        time_shift:
          - time_dimension: log_date
            interval: 1 month
            type: prior
        description: Same measure as revenue_vnd_total, shifted back one month
```

Query (current and prior month-to-date, side-by-side per OS):
```json
{
  "measures": [
    "user_recharge_daily.revenue_vnd_total",
    "user_recharge_daily.revenue_vnd_prev_month"
  ],
  "timeDimensions": [{
    "dimension": "user_recharge_daily.log_date",
    "dateRange": "this month"
  }],
  "dimensions": ["user_recharge_daily.os_platform"]
}
```

Cube takes care of the MTD alignment. Want "vs last week" instead? Add another measure with `interval: 1 week` — one YAML block, every downstream surface gets it.

---

### 6 · T2 · "Trailing 7-day revenue per acquisition channel, with growth % vs the prior 7-day window"

**Column 1 — Business question.** Growth team needs a rolling-7d revenue chart per acquisition channel with the WoW growth % overlay, refreshed hourly, so they can spot a channel cratering before the daily standup.

**Column 2 — If we built this without a semantic layer.**

Raw SQL (window functions + correlated date arithmetic):
```sql
WITH daily AS (
  SELECT m.media_source,
         d.log_date,
         SUM(d.ingame_total_recharge_value_vnd) AS revenue_vnd
  FROM std_ingame_user_recharge_daily d
  JOIN mf_users m ON d.user_id = m.user_id
  WHERE d.log_date >= CURRENT_DATE - INTERVAL '14' DAY
  GROUP BY m.media_source, d.log_date
),
rolling AS (
  SELECT media_source, log_date,
         SUM(revenue_vnd) OVER (
           PARTITION BY media_source
           ORDER BY log_date
           RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW
         ) AS revenue_7d_trailing,
         SUM(revenue_vnd) OVER (
           PARTITION BY media_source
           ORDER BY log_date
           RANGE BETWEEN INTERVAL '13' DAY PRECEDING AND INTERVAL '7' DAY PRECEDING
         ) AS revenue_7d_prior
  FROM daily
)
SELECT media_source, log_date,
       revenue_7d_trailing,
       revenue_7d_prior,
       (revenue_7d_trailing - revenue_7d_prior) * 1.0 / NULLIF(revenue_7d_prior, 0) AS growth_pct
FROM rolling
WHERE log_date = CURRENT_DATE;
```

CDP metric records needed:
- `revenue_7d_trailing_<channel>` — one per media_source
- `revenue_7d_prior_<channel>` — same per channel
- `revenue_7d_growth_pct_<channel>` — derived metric per channel
- Repeat for 14d / 28d trailing windows — **× window count**
- Repeat per country if marketing slices further — **× country count**
- A `media_source × window × country` grid = dozens of records, every one containing a full copy of the window-function CTE

Why this hurts:
- Window functions are the most-often-broken SQL in any codebase. Every CDP record re-encoding them is a new place for a bug.
- The join from `std_ingame_user_recharge_daily` to `mf_users` to get `media_source` is the same join repeated in every record — one schema rename breaks all of them.
- No central declaration that this metric is *rolling-window-aware*, so it can't safely be combined with other time filters.

**Column 3 — How Cube handles it (full YAML).**

The `mf_users` join already exists on `user_recharge_daily`. Add the rolling-window measure plus a time-shifted companion:
```yaml
cubes:
  - name: user_recharge_daily
    sql_table: std_ingame_user_recharge_daily
    joins:
      - name: mf_users
        relationship: many_to_one
        sql: "{CUBE}.user_id = {mf_users}.user_id"
    dimensions:
      - name: log_date
        sql: "from_iso8601_timestamp(CAST({CUBE}.log_date AS VARCHAR) || 'T00:00:00Z')"
        type: time
    measures:
      - name: revenue_7d_trailing
        sql: ingame_total_recharge_value_vnd
        type: sum
        rolling_window:
          trailing: 7 day
      - name: revenue_7d_prior
        sql: ingame_total_recharge_value_vnd
        type: sum
        rolling_window:
          trailing: 7 day
          offset: end
        time_shift:
          - time_dimension: log_date
            interval: 7 day
            type: prior
      - name: revenue_7d_growth_pct
        sql: "({revenue_7d_trailing} - {revenue_7d_prior}) * 1.0 / NULLIF({revenue_7d_prior}, 0)"
        type: number
        format: percent
```

Query:
```json
{
  "measures": [
    "user_recharge_daily.revenue_7d_trailing",
    "user_recharge_daily.revenue_7d_prior",
    "user_recharge_daily.revenue_7d_growth_pct"
  ],
  "dimensions": ["mf_users.media_source"],
  "timeDimensions": [{
    "dimension": "user_recharge_daily.log_date",
    "dateRange": "today"
  }]
}
```

Add a 14-day variant? Copy the three measures, change `7 day` to `14 day`. Add a country slice? Add `mf_users.country` to `dimensions` in the query — no YAML change.

---

### 7 · T2 · "Of users who first installed in Jan 2026, what % made their first recharge within 30 days?"

**Column 1 — Business question.** UA team needs a conversion benchmark per install cohort. Same question gets asked monthly for the new month's cohort, and per acquisition channel, and per country.

**Column 2 — If we built this without a semantic layer.**

Raw SQL:
```sql
WITH cohort AS (
  SELECT user_id, install_date
  FROM mf_users
  WHERE install_month = '2026-01'
),
converted AS (
  SELECT c.user_id,
         MIN(r.recharge_time) AS first_recharge_at
  FROM cohort c
  LEFT JOIN etl_ingame_recharge r ON r.account_id = c.user_id
  GROUP BY c.user_id
)
SELECT
  COUNT(*) AS cohort_size,
  COUNT(CASE WHEN DATE_DIFF('day', cohort.install_date, converted.first_recharge_at) <= 30
             THEN 1 END) AS converted_30d,
  COUNT(CASE WHEN DATE_DIFF('day', cohort.install_date, converted.first_recharge_at) <= 30
             THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) AS conversion_rate
FROM cohort
LEFT JOIN converted USING (user_id);
```

CDP metric records needed:
- `conv_30d_install_2026_01_total`
- `conv_30d_install_2026_01_vn`, `..._th`, etc. — per country
- `conv_30d_install_2026_01_facebook`, `..._google`, etc. — per acquisition channel
- Repeat the entire set every month for new cohorts (`2026_02`, `2026_03`, …)
- Repeat for `conv_7d`, `conv_14d`, `conv_60d` if product wants other windows

Why this hurts:
- **Cohort drift.** A user's `install_month` might shift if the MMP attribution updates retroactively. Without a single named cohort, "2026-01 cohort size" differs across dashboards based on when their CDP record was last refreshed.
- **N new records per month forever** — Jan 2026 cohort, Feb 2026 cohort, … Each one is a separate CRUD entry in CDP.
- **The 30d-from-install probe** is the bug-prone part (timezone, date math). Every record re-encodes it.

**Column 3 — How Cube handles it (full YAML).**

Add a `sub_query` dimension to `mf_users` for the per-user conversion flag, plus a derived rate measure:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    joins:
      - name: recharge
        relationship: one_to_many
        sql: "{CUBE}.user_id = {recharge}.account_id"
    dimensions:
      - name: install_month
        sql: install_month
        type: string
      - name: converted_30d
        sub_query: true
        sql: "{converted_30d_flag}"
        type: number
        description: 1 if first recharge within 30d of install, else 0
    measures:
      - name: converted_30d_flag
        type: max
        sql: "CASE
                WHEN DATE_DIFF('day', {CUBE}.install_date, {recharge}.recharge_time) <= 30
                THEN 1 ELSE 0
              END"
      - name: cohort_size
        type: count_distinct
        sql: user_id
      - name: converted_30d_count
        type: count_distinct
        sql: user_id
        filters:
          - sql: "{CUBE}.converted_30d = 1"
      - name: conversion_rate_30d
        sql: "{converted_30d_count} * 1.0 / NULLIF({cohort_size}, 0)"
        type: number
        format: percent
```

Query for the Jan 2026 cohort:
```json
{
  "measures": ["mf_users.conversion_rate_30d", "mf_users.cohort_size"],
  "filters": [{ "member": "mf_users.install_month", "operator": "equals", "values": ["2026-01"] }]
}
```

Want the Feb cohort? Change the filter value. By country? Add `mf_users.country` to dimensions. By acquisition channel? Add `mf_users.media_source`. **One YAML block answers every cohort × every slice forever.**

---

### 8 · T2 · "Per-user 7-day spend tier (high / mid / low) as a groupable column on every user"

**Column 1 — Business question.** Segmenter wants to group every user by their last-7-days spend (high/mid/low) and then cross-tab against gameplay metrics, churn risk, country, etc. The 7-day window should be live, not the pre-baked 30-day column.

**Column 2 — If we built this without a semantic layer.**

Raw SQL (correlated subquery per user, then a CASE):
```sql
WITH user_7d_spend AS (
  SELECT m.user_id,
         COALESCE(SUM(d.ingame_total_recharge_value_vnd), 0) AS spend_7d
  FROM mf_users m
  LEFT JOIN std_ingame_user_recharge_daily d
    ON d.user_id = m.user_id
   AND d.log_date >= CURRENT_DATE - INTERVAL '7' DAY
  GROUP BY m.user_id
),
tiered AS (
  SELECT user_id, spend_7d,
         CASE
           WHEN spend_7d >= 500000 THEN 'high'
           WHEN spend_7d >= 100000 THEN 'mid'
           WHEN spend_7d > 0       THEN 'low'
           ELSE 'none'
         END AS spend_tier_7d
  FROM user_7d_spend
)
-- … then join `tiered` back to whatever else you want to cross-tab
```

CDP metric records needed:
- `user_count_spend_tier_7d_high`, `user_count_spend_tier_7d_mid`, `user_count_spend_tier_7d_low`, `user_count_spend_tier_7d_none`
- × country (5+) = 20+ records
- × OS platform = 40+ records
- × any other downstream slice consumer wants
- A separate record for *each* downstream join — there's no per-user dimension concept in CDP, only aggregate metrics

Why this hurts:
- **CDP doesn't have a "user-level column" concept.** It serves aggregate values. So "per-user spend tier as a dimension" is structurally impossible — you can only ever surface counts of users at each tier, never cross-tab with anything new.
- The per-user spend calculation is recomputed inside every metric's SQL string.

**Column 3 — How Cube handles it (full YAML).**

Add a `sub_query` dimension + banding case on `mf_users`:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    joins:
      - name: user_recharge_daily
        relationship: one_to_many
        sql: "{CUBE}.user_id = {user_recharge_daily}.user_id"
    measures:
      - name: spend_7d_vnd_helper
        sql: ingame_total_recharge_value_vnd
        type: sum
        filters:
          - sql: "{user_recharge_daily}.log_date >= CURRENT_DATE - INTERVAL '7' DAY"
    dimensions:
      - name: spend_7d_vnd
        sub_query: true
        sql: "{spend_7d_vnd_helper}"
        type: number
      - name: spend_tier_7d
        type: string
        case:
          when:
            - sql: "{CUBE}.spend_7d_vnd >= 500000"
              label: high
            - sql: "{CUBE}.spend_7d_vnd >= 100000"
              label: mid
            - sql: "{CUBE}.spend_7d_vnd > 0"
              label: low
          else:
            label: none
```

Now `spend_tier_7d` is **just another dimension on `mf_users`** — it composes with every existing measure, segment, and slice.

Query examples:
```json
{ "measures": ["mf_users.user_count_approx"],
  "dimensions": ["mf_users.spend_tier_7d", "mf_users.country"] }
```
```json
{ "measures": ["active_daily.dau"],
  "dimensions": ["mf_users.spend_tier_7d"] }
```
```json
{ "measures": ["mf_users.arppu_vnd"],
  "segments": ["mf_users.vn_users"],
  "dimensions": ["mf_users.spend_tier_7d"] }
```

This is the move CDP literally cannot make today: **a per-user computed dimension that other metrics can group by**. The semantic layer turns a metric into a reusable axis.

---

### 9 · T3 · "D-1 / D-7 / D-30 retention for paid-install vs organic-install cohorts"

**Column 1 — Business question.** Performance marketing wants the classic retention curve for paid vs organic, refreshed weekly, per country, per OS. The numbers must match what's reported up to finance.

**Column 2 — If we built this without a semantic layer.**

Raw SQL (probe activity at D+1, D+7, D+30 from install):
```sql
WITH base AS (
  SELECT user_id, install_date, is_paid_install,
         unified_first_country_code AS country,
         unified_first_os_platform   AS os
  FROM mf_users
  WHERE install_month = '2026-01'
),
probes AS (
  SELECT b.user_id, b.install_date, b.is_paid_install, b.country, b.os,
         MAX(CASE WHEN a.log_date = b.install_date + INTERVAL '1'  DAY THEN 1 ELSE 0 END) AS d1,
         MAX(CASE WHEN a.log_date = b.install_date + INTERVAL '7'  DAY THEN 1 ELSE 0 END) AS d7,
         MAX(CASE WHEN a.log_date = b.install_date + INTERVAL '30' DAY THEN 1 ELSE 0 END) AS d30
  FROM base b
  LEFT JOIN std_ingame_user_active_daily a ON a.user_id = b.user_id
  GROUP BY 1,2,3,4,5
)
SELECT is_paid_install, country, os,
       SUM(d1)  * 1.0 / COUNT(*) AS d1_retention,
       SUM(d7)  * 1.0 / COUNT(*) AS d7_retention,
       SUM(d30) * 1.0 / COUNT(*) AS d30_retention
FROM probes
GROUP BY is_paid_install, country, os;
```

CDP metric records needed:
- `d1_retention_paid_<country>_<os>`, `d1_retention_organic_<country>_<os>` — × all combos
- Same for D7, D30 — **× 3 windows**
- Per cohort (`install_month`) — **× N months** going forward
- A typical setup: 2 paid statuses × 5 countries × 2 OS × 3 windows × 12 months = **720 CDP records**
- Each one stores the same retention probe SQL with a different cohort filter

Why this hurts:
- The D+N probe alignment is fragile; one timezone bug means every record needs editing.
- New campaign cohort? Another month, another 60 records.
- D14 retention? Another 240 records. Each one a copy of the same join.

**Column 3 — How Cube handles it (full YAML).**

Two options. **Path A (recommended): add three columns to the `mf_users` ETL** (`is_active_d1`, `is_active_d7`, `is_active_d30`). Then the YAML is trivial:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    dimensions:
      - name: is_paid_install
        sql: is_paid_install
        type: boolean
      - name: install_month
        sql: install_month
        type: string
    measures:
      - name: cohort_size
        type: count_distinct
        sql: user_id
      - name: retained_d1
        type: count_distinct
        sql: user_id
        filters: [{ sql: "{CUBE}.is_active_d1 = TRUE" }]
      - name: retained_d7
        type: count_distinct
        sql: user_id
        filters: [{ sql: "{CUBE}.is_active_d7 = TRUE" }]
      - name: retained_d30
        type: count_distinct
        sql: user_id
        filters: [{ sql: "{CUBE}.is_active_d30 = TRUE" }]
      - name: d1_retention
        sql: "{retained_d1} * 1.0 / NULLIF({cohort_size}, 0)"
        type: number
        format: percent
      - name: d7_retention
        sql: "{retained_d7} * 1.0 / NULLIF({cohort_size}, 0)"
        type: number
        format: percent
      - name: d30_retention
        sql: "{retained_d30} * 1.0 / NULLIF({cohort_size}, 0)"
        type: number
        format: percent
```

**Path B (no ETL change, slower):** define `sub_query: true` dimensions that probe `active_daily` for each user — same shape as row 8.

Query:
```json
{
  "measures": ["mf_users.d1_retention", "mf_users.d7_retention", "mf_users.d30_retention"],
  "dimensions": ["mf_users.is_paid_install", "mf_users.country", "mf_users.os_platform"],
  "filters": [{ "member": "mf_users.install_month", "operator": "equals", "values": ["2026-01"] }]
}
```

D14 retention? One column upstream + one measure + one ratio = 3 YAML blocks, every consumer surface updates.

---

### 10 · T3 · "Live audience for tomorrow's push: whales in VN who haven't recharged in 14 days, by media source"

**Column 1 — Business question.** Campaign manager builds tomorrow's re-engagement push. They need (a) the audience size by media source to forecast cost, and (b) the list of user IDs to hand to the push pipeline. Same shape of question is asked weekly with different segment combos.

**Column 2 — If we built this without a semantic layer.**

Raw SQL for the size:
```sql
SELECT media_source, COUNT(DISTINCT user_id) AS audience_size
FROM mf_users
WHERE unified_first_country_code = 'VN'
  AND ingame_total_recharge_value_vnd >= 10000000
  AND DATE_DIFF('day', ingame_last_recharge_date, CURRENT_DATE) >= 14
GROUP BY media_source;
```

Raw SQL for the ID list (similar, no aggregate, paginated).

CDP metric records needed:
- `audience_whales_vn_lapsed_14d_<media_source>` — one per channel
- Plus an ID-list endpoint that re-encodes the WHERE clause
- Next week's campaign: "whales in TH who haven't logged in for 7 days" → another set of records, hand-written
- Combinatorial: each campaign team writes new SQL each week. Audiences end up duplicated, drifted, and re-validated each time.

Why this hurts:
- **Audience definitions don't compose in CDP.** Each combo is a fresh CRUD entry. Six weeks in, you have 50 nearly-identical SQL strings.
- **No reusability across campaigns.** "Whales" is defined in 50 places.
- **No real-time count.** Each audience size is a snapshot at last-CRUD-update; live count needs an ad-hoc query.

**Column 3 — How Cube handles it (full YAML).**

Add the lapsed-payer segment:
```yaml
cubes:
  - name: mf_users
    sql_table: mf_users
    segments:
      - name: vn_users
        sql: "{CUBE}.unified_first_country_code = 'VN'"
      - name: whales
        sql: "{CUBE}.ingame_total_recharge_value_vnd >= 10000000"
      - name: lapsed_payer_14d
        sql: "DATE_DIFF('day', {CUBE}.ingame_last_recharge_date, CURRENT_DATE) >= 14"
```

Query for audience size:
```json
{
  "measures": ["mf_users.user_count_approx"],
  "segments": ["mf_users.whales", "mf_users.vn_users", "mf_users.lapsed_payer_14d"],
  "dimensions": ["mf_users.media_source"]
}
```

Query for the user-ID list (CDP-style push target):
```json
{
  "dimensions": ["mf_users.user_id", "mf_users.media_source"],
  "segments": ["mf_users.whales", "mf_users.vn_users", "mf_users.lapsed_payer_14d"],
  "limit": 50000
}
```

Tomorrow's campaign is "dolphins in TH lapsed 7d"? Define `lapsed_payer_7d` once, swap two segment names. CDP becomes a thin REST handler that maps "audience name → segment names" — no SQL ever touched.

---

### 11 · T3 · "Sub-second dashboard: DAU by country × payer tier × day, last 30 days"

**Column 1 — Business question.** The CEO dashboard must load in under one second, refreshed hourly, showing DAU per country, broken down by payer tier, over the last 30 days. Currently the dashboard scans raw user-day rows on each load and takes 6-10 seconds.

**Column 2 — If we built this without a semantic layer.**

Raw SQL (slow):
```sql
SELECT m.unified_first_country_code AS country,
       CASE WHEN m.ingame_total_recharge_value_vnd >= 10000000 THEN 'whale'
            WHEN m.ingame_total_recharge_value_vnd >= 1000000  THEN 'dolphin'
            WHEN m.ingame_total_recharge_value_vnd > 0         THEN 'minnow'
            ELSE 'non_payer' END AS payer_tier,
       a.log_date,
       APPROX_DISTINCT(a.user_id) AS dau
FROM std_ingame_user_active_daily a
JOIN mf_users m ON a.user_id = m.user_id
WHERE a.log_date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY 1,2,3;
```

To get it under 1s you'd build a rollup table by hand:
```sql
CREATE TABLE dashboard_dau_by_country_tier_daily AS
  -- run the above query nightly, materialize into a small table
```
Then write a refresh cron, partition by month, add backfill scripts, build cache-invalidation logic, manage rebuild after schema changes, etc.

CDP metric records needed: not really CDP's role — but if you tried, **one record per (country, tier, day) point** = 5 × 4 × 30 = 600 records, refreshed daily. The CRUD model breaks down here.

Why this hurts:
- Every dashboard team that wants speed builds their own rollup table, with their own refresh schedule, their own naming convention. **No shared rollup infrastructure.**
- The CASE for `payer_tier` re-appears in this rollup table; if the threshold changes upstream, rollups go stale silently.
- Backfills and partitioned refreshes are ad-hoc engineering each time.

**Column 3 — How Cube handles it (full YAML).**

This is **already shipped** in `active_daily`:
```yaml
cubes:
  - name: active_daily
    sql_table: std_ingame_user_active_daily
    joins:
      - name: mf_users
        relationship: many_to_one
        sql: "{CUBE}.user_id = {mf_users}.user_id"
    measures:
      - name: dau
        type: count_distinct_approx
        sql: user_id
    pre_aggregations:
      - name: dau_by_country_payer_daily
        type: rollup
        measures:
          - dau
        dimensions:
          - mf_users.country
          - mf_users.payer_tier
        time_dimension: log_date
        granularity: day
        partition_granularity: month
        refresh_key:
          every: 1 hour
          incremental: true
        build_range_start:
          sql: "SELECT DATE '2024-01-01'"
        build_range_end:
          sql: "SELECT CURRENT_DATE"
```

Query (auto-routed to the rollup table):
```json
{
  "measures": ["active_daily.dau"],
  "dimensions": ["mf_users.country", "mf_users.payer_tier"],
  "timeDimensions": [{
    "dimension": "active_daily.log_date",
    "granularity": "day",
    "dateRange": "last 30 days"
  }]
}
```

The same rollup also serves week / month / quarter / year queries because `count_distinct_approx` uses HLL sketches that merge across grains. Want a new dashboard cut? Add another pre_aggregation block — Cube manages partitions, incremental refresh, backfill, cache invalidation.

---

### 12 · T4 · "Users currently on a 5+ consecutive loss streak in the last 7 days, by country and OS"

**Column 1 — Business question.** Liveops wants to detect frustrated players and trigger a soft re-engagement offer. The definition: a user whose last 5 (or more) consecutive game results within the last 7 days were losses.

**Column 2 — If we built this without a semantic layer.**

Raw SQL — gap-and-island streak detection:
```sql
WITH ordered AS (
  SELECT user_id, game_ts, outcome,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY game_ts)            AS rn_all,
         ROW_NUMBER() OVER (PARTITION BY user_id, outcome ORDER BY game_ts)   AS rn_outcome
  FROM etl_gameplay_table
  WHERE game_ts >= CURRENT_TIMESTAMP - INTERVAL '7' DAY
),
runs AS (
  SELECT user_id, outcome,
         (rn_all - rn_outcome) AS run_id,
         COUNT(*)              AS run_length,
         MAX(game_ts)          AS run_end_ts
  FROM ordered
  GROUP BY user_id, outcome, (rn_all - rn_outcome)
),
streaks AS (
  SELECT user_id,
         MAX(CASE WHEN outcome = 'loss' THEN run_length ELSE 0 END) AS max_loss_streak_7d
  FROM runs GROUP BY user_id
)
SELECT m.unified_first_country_code AS country,
       m.unified_first_os_platform   AS os,
       COUNT(DISTINCT s.user_id)     AS users_on_streak
FROM streaks s
JOIN mf_users m ON m.user_id = s.user_id
WHERE s.max_loss_streak_7d >= 5
GROUP BY 1,2;
```

CDP metric records needed:
- `users_on_5_loss_streak_7d_<country>_<os>` — for every combo
- `users_on_3_loss_streak_7d_…` if a different campaign uses a different threshold
- `users_on_5_loss_streak_3d_…` if window changes
- For each streak threshold × window × slice combo: another CRUD entry with the full window-function CTE re-encoded
- **The same `(rn_all - rn_outcome)` trick lives in dozens of SQL strings, each one a chance to get wrong.**

Why this hurts:
- Streak SQL is the highest-risk SQL in the company — window functions, ordering, NULL handling, timezone boundaries.
- Per-campaign tuning of streak threshold or window means another full SQL CRUD.
- No place to attach governance, freshness SLA, or PII policy to "streak."

**Column 3 — How Cube handles it (full YAML).**

Cube YAML cannot compute streaks (no window-function-over-ordered-partition primitive in measure SQL). Compute the streak in a warehouse view, then publish in YAML.

Warehouse view (data eng owns):
```sql
CREATE OR REPLACE VIEW vw_user_loss_streaks_7d AS
WITH ordered AS (
  SELECT user_id, game_ts, outcome,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY game_ts)          AS rn_all,
         ROW_NUMBER() OVER (PARTITION BY user_id, outcome ORDER BY game_ts) AS rn_outcome
  FROM etl_gameplay_table
  WHERE game_ts >= CURRENT_TIMESTAMP - INTERVAL '7' DAY
),
runs AS (
  SELECT user_id, outcome, (rn_all - rn_outcome) AS run_id, COUNT(*) AS run_length
  FROM ordered GROUP BY user_id, outcome, (rn_all - rn_outcome)
)
SELECT user_id,
       MAX(CASE WHEN outcome='loss' THEN run_length ELSE 0 END) AS max_loss_streak_7d
FROM runs GROUP BY user_id;
```

New cube `user_loss_streaks_7d.yml`:
```yaml
cubes:
  - name: user_loss_streaks_7d
    sql_table: vw_user_loss_streaks_7d
    refresh_key:
      every: 1 hour
    joins:
      - name: mf_users
        relationship: many_to_one
        sql: "{CUBE}.user_id = {mf_users}.user_id"
    dimensions:
      - name: user_id
        sql: user_id
        type: string
        primary_key: true
      - name: max_loss_streak_7d
        sql: max_loss_streak_7d
        type: number
```

Wire into `mf_users.yml`:
```yaml
cubes:
  - name: mf_users
    joins:
      - name: user_loss_streaks_7d
        relationship: one_to_one
        sql: "{CUBE}.user_id = {user_loss_streaks_7d}.user_id"
    segments:
      - name: on_5_loss_streak_7d
        sql: "{user_loss_streaks_7d}.max_loss_streak_7d >= 5"
    measures:
      - name: users_on_5_loss_streak_7d
        type: count_distinct_approx
        sql: user_id
        filters:
          - sql: "{user_loss_streaks_7d}.max_loss_streak_7d >= 5"
```

Query:
```json
{
  "measures": ["mf_users.users_on_5_loss_streak_7d"],
  "dimensions": ["mf_users.country", "mf_users.os_platform"]
}
```

The cube becomes the **publishing layer**, not the engine — but the streak is now addressable by every consumer surface (MCP, CDP, BI) by name, governed by the same access policy as every other metric, and composable with every other dimension/segment. Same pattern works for funnels, sequences, journeys.

---

### 13 · T4 · "Auto-publish every metric defined in the wizard as both an MCP tool and a CDP audience, without writing code"

**Column 1 — Business question.** The whole point of the wizard work. A non-SQL game analyst publishes a metric in the wizard; an LLM agent can call it that same minute via MCP; the campaign engine can use it as an audience via CDP — none of which requires a developer to write code.

**Column 2 — If we built this without a semantic layer.**

Today's flow per new metric:
- Analyst describes the metric in a ticket.
- A data engineer writes the SQL.
- A backend engineer writes an MCP tool handler that runs that SQL.
- A backend engineer writes a CDP CRUD entry containing that SQL (often a copy of the MCP version that drifts later).
- A dashboard engineer builds the chart.

Per-metric cost: 3-5 days, 4 owners, 4 places the SQL lives. No metadata layer that says "metric X exists" — agents must be retrained, CDP must be CRUD'd, dashboards must be hand-built.

CDP metric records needed: **every** metric that exists or will exist — one CRUD entry per metric per slicing variant. **The metric catalogue is the CRUD table.** Growing it linearly is the bottleneck.

Why this hurts:
- The bottleneck moves from data modelling to *integration engineering*. The team building campaigns is paying for plumbing every week.
- LLM agents can't introspect "what metrics exist?" — there's no catalogue endpoint, only a CRUD table they can't see.
- CDP and MCP duplicate the same SQL by hand and drift.

**Column 3 — How Cube handles it (full YAML + integration sketch).**

Cube exposes a metadata endpoint that lists every measure, dimension, and segment with types and descriptions. Hitting it returns something like:

```json
GET /cubejs-api/v1/meta
{
  "cubes": [
    {
      "name": "mf_users",
      "title": "Ballistar VN — User Master Profile",
      "measures": [
        { "name": "mf_users.paying_users", "title": "Paying Users",
          "type": "number", "aggType": "countDistinct" },
        { "name": "mf_users.arppu_vnd", "title": "Average Revenue Per Paying User",
          "type": "number", "format": "currency" },
        { "name": "mf_users.users_on_5_loss_streak_7d", "title": "Users on 5+ Loss Streak (7d)",
          "type": "number" }
      ],
      "dimensions": [
        { "name": "mf_users.country", "type": "string" },
        { "name": "mf_users.payer_tier", "type": "string" },
        { "name": "mf_users.spend_tier_7d", "type": "string" }
      ],
      "segments": [
        { "name": "mf_users.whales", "title": "Whales", "description": "Lifetime recharge >= 10M VND" },
        { "name": "mf_users.lapsed_payer_14d", "title": "Lapsed Payers 14d" }
      ]
    }
  ]
}
```

**MCP server** reads this once at startup (and on a webhook fired by Cube when YAML changes) and generates one callable tool per measure. No human writes endpoint code — the wizard publishing a new measure adds a new MCP tool the next minute.

**CDP** stops storing SQL strings. Its CRUD record per metric becomes a thin pointer:
```json
{
  "metric_name": "audience_whales_vn_lapsed_14d",
  "cube_query": {
    "measures": ["mf_users.user_count_approx"],
    "segments": ["mf_users.whales", "mf_users.vn_users", "mf_users.lapsed_payer_14d"]
  },
  "cache_ttl_s": 300
}
```
or even simpler: just `{ measures, segments }` resolved at request time. CRUD reduces to "register a name + a Cube query."

**Dashboard layer** points BI tools at Cube's SQL API (`port :15432`, Postgres wire), and Tableau / Metabase / Hex auto-discover every cube as if it were a Postgres table.

What's left to build: a webhook from Cube → MCP/CDP on metadata change (1-2 days), a thin CDP schema migration to swap inline SQL for `cube_query` pointers (~1 week). Then every wizard-published metric ships to every consumer for free.

---

### Phasing implications from the table

- **Tier 1 (rows 1-4): ship immediately.** All required YAML is in the metrics-catalogue today. The wizard surfacing dim/segment authoring unlocks broader self-serve.
- **Tier 2 (rows 5-8): wizard expansion + minor YAML additions.** Time-shift, rolling-window, multi_stage, sub_query — native to Cube, none authored by the wizard yet.
- **Tier 3 (rows 9-11): cohort / retention / sub-second dashboards.** Mix of YAML pattern adoption and pre-aggregation planning. The DAU rollup is already exemplified in `active_daily.yml` — copy that pattern for every hot dashboard.
- **Tier 4 (rows 12-13): upstream views + delivery surface.** Streak-class metrics require a warehouse-view layer (data eng ownership question). MCP/CDP auto-publishing is the delivery payoff that justifies the entire investment — once row 13 lands, every Tier 1-3 metric ships to all three surfaces for free.

---

## Section 2 — Operating the data product: capabilities tied to business value

Section 1 covered "what questions we stop hand-coding." Section 2 covers "how the platform earns its keep operationally" — access control, freshness, cost, evolution, delivery. Each row is a business outcome, not a feature.

| Business outcome | What in Cube delivers it | Concrete shape in our setup |
|---|---|---|
| **Multi-game / multi-studio tenant isolation** — one semantic layer serves all VNG titles, each team sees only their game's data | `access_policy.row_level.filters` bound to JWT `securityContext` claims | Add to each cube:<br>`access_policy:`<br>&nbsp;`- conditions: [{ if: "{securityContext.tenant_id} != null" }]`<br>&nbsp;&nbsp;`row_level:`<br>&nbsp;&nbsp;&nbsp;`filters:`<br>&nbsp;&nbsp;&nbsp;&nbsp;`- member: tenant_id`<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`operator: equals`<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`values: ["{securityContext.tenant_id}"]`<br>Auth header → tenant filter on every query, every consumer. Stop maintaining per-tenant ACL logic in MCP and CDP separately. |
| **PII compliance / data protection audit** — analyst dashboards never expose email / phone / device fingerprint | `member_level.excludes` per role + `public: false` on sensitive fields | `appsflyer_id` already hidden via `public: false`. Compliance review becomes a single grep of the cubes directory. Adding a new PII column = one YAML line + a PR — not a Confluence ticket. |
| **Persona-tailored data products** — finance sees revenue only, marketing sees acquisition only, product sees engagement only | `views:` curating subsets of cubes for each consumer surface | Define `finance_view` exposing `[ltv_*, arppu, paying_*, country, install_month]`; `marketing_view` exposing `[media_source, campaign_id, paid_install, first_active_*]`. Same model, three public APIs. |
| **Predictable warehouse cost** — analytics bill scales with metrics, not with users-querying-metrics | `pre_aggregations` + Cube Store offloading | Today every dashboard scan hits Trino raw events. With pre-aggs: warehouse builds N rollups/day, dashboards hit Cube Store at near-zero cost. Bill = `(rollup count) × (refresh frequency) × (build cost)` — a budget you can plan. |
| **Freshness SLAs aligned to use case** — finance-close dashboard daily, ops dashboard hourly, campaign trigger sub-minute | `refresh_key.every` per cube + per pre_aggregation | Already differentiated today: mf_users `1 hour`, recharge `5 minute`, active_daily `30 minute`. Streak rollup nightly, audience-eligibility hourly, executive scorecard daily — one model, multiple freshness contracts. |
| **Auditability & change governance** — every metric definition has an author, a reviewer, a created_at | YAML in git + `meta:` block on measures + PR review | Pattern already in use: wizard-published measures carry `meta.source: wizard`, `meta.author`, `meta.created_at`. SOC 2 / GDPR audit trail = git log. No separate "metric registry" system to maintain. |
| **Backward-compatible schema evolution** — rename a warehouse column without breaking 40 dashboards | `views:` insulating consumers from cube/source refactors | When `ingame_total_recharge_value_vnd_30d` is renamed upstream, you update one line in mf_users.yml. Every view, dashboard, MCP tool, CDP audience continues working unchanged. |
| **Real-time eligibility for liveops triggers** — push to users *the moment* they enter a segment | REST `/v1/load` + WebSocket subscriptions + Cube Store sub-second serving | Campaign engine subscribes to a query like `{ measures: [user_count_approx], segments: [whales, lapsed_payer_14d] }` per tenant — gets pushed an updated count as the underlying rollup refreshes. Threshold-cross triggers a campaign. No polling, no batch lag. |
| **Single source of truth across MCP / CDP / BI** — every consumer surface speaks the same names | Three APIs over one model (REST / GraphQL / Postgres-wire SQL) + `/v1/meta` introspection | MCP auto-discovers measures via `/v1/meta`. CDP fetches by name via `/v1/load`. Tableau / Metabase / Hex plug into Cube as a Postgres database. One YAML change updates all three surfaces. |
| **AI-agent-friendly metric surface** — agents call metrics by name instead of generating SQL | Stable measure names + typed metadata catalogue at `/v1/meta` | LLM agents don't need to learn the warehouse dialect; they read the catalogue and call by name. Wizard publishing `whales_in_vn_lapsed_14d` → agent can reference it in the same turn. Compresses agent context from 50KB of SQL examples to 2KB of catalogue. |
| **Federated hot + cold storage** — combine warehouse data with real-time event streams in one query | `data_source:` per cube, multi-source joins | mf_users in Trino (warehouse), real-time session events in ClickHouse, in-memory user state in Redis — each cube picks its store, Cube federates the join. A campaign rule like "whales (warehouse) who just opened the IAP shop (Redis) in the last 60s" is one query. |

### Why these two sections together make the case

Section 1 makes the **product** case: 13 questions, each one a recurring meeting between dashboard / MCP / CDP teams, collapsed into a single YAML object owned by a metric author. Section 2 makes the **platform** case: the same model also delivers access control, cost control, freshness tiers, real-time delivery, and a stable contract for AI agents — capabilities we'd otherwise have to build (and maintain) three times across our existing surfaces.

The branch we're shipping (`feat/new-metric-dim-segment-authoring`) is the *authoring* side of Section 1's Tier 1. The infrastructure side of Section 2 is largely free once Cube is the canonical model — but it requires us to commit to that role for Cube, not run it as one more downstream system.

---

## Open questions for the team

1. **Tenancy model.** Single Cube deployment per game title, or single multi-tenant deployment with `access_policy` row filters? Drives Section 2 row 1 implementation cost.
2. **Upstream view ownership.** Tier 4 metrics (streaks, funnels, sequences) need warehouse-side views. Who owns adding them — data eng, analytics eng, or the metric author with a templated SQL handoff from the wizard?
3. **Default modelling path.** When a metric exists in both `mf_users` (pre-materialized column) and an event cube (joined filtered measure) — which do we recommend by default? Trade-off is wider `mf_users` table vs fresher event-cube grain.
4. **Refresh SLA tier map.** What's our standard freshness tier list (e.g. `realtime: 5min`, `near-real: 30min`, `dashboard: 1h`, `finance: 24h`) and which cubes/rollups land in each tier?
5. **MCP integration migration.** Does the MCP tool switch entirely to `/v1/meta` introspection, or do we keep some hand-written endpoints for performance-critical paths? Same for CDP — does `MM-01-CRUD` become "register-by-Cube-name" or do we keep CDP-specific overrides for sub-second eligibility paths?
6. **`access_policy` default posture.** Deny-by-default from day one, or start permissive and tighten after consumers are connected?
7. **Wizard handling of "Cube can only partially express."** When a user authors a streak / funnel / sequence metric, does the wizard refuse, generate a template SQL view for data eng, or auto-create the view in a sandbox schema?
