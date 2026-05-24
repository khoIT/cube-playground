# Cube model gaps — measures the metrics registry refers to but ballistar doesn't define

Authoritative cube model: `cube-dev/cube/model/cubes/ballistar/`.
Registry: `server/src/presets/business-metrics/`.

Run `npm --prefix server run check:metric-drift` against a live Cube to get
the per-game version of this. This doc is the static snapshot vs ballistar
as of 2026-05-24.

## ✅ Refs that resolve today

| Ref | Cube file |
|---|---|
| `active_daily.dau` / `active_daily.mau` | `ballistar/active_daily.yml` |
| `mf_users.arpu_vnd` / `mf_users.arppu_vnd` | `ballistar/mf_users.yml` |
| `mf_users.ltv_total_vnd` | `ballistar/mf_users.yml` |
| `mf_users.paying_rate_30d` / `mf_users.paying_users_30d` | `ballistar/mf_users.yml` |
| `recharge.revenue_vnd` / `recharge.paying_users` / `recharge.transactions` | `ballistar/recharge.yml` |

Everything below this line is unresolved against ballistar.

## ❌ Measures needed on `mf_users`

Acquisition / marketing (currently lives in MMP staging, not surfaced to Cube):

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `impressions` | `sum(impressions)` from MMP daily | #2 |
| `clicks` | `sum(clicks)` from MMP daily | #3 |
| `installs` | `count_distinct_approx(appsflyer_id)` filtered to non-block, non-reinstall | #5 |
| `paid_installs` | same as `installs` with `is_paid_install = true` | #6 |
| `organic_installs` | same as `installs` with `is_paid_install = false` | #7 |
| `marketing_cost` | `sum(spend_usd)` from MMP daily | #1 |
| `new_users` | `count_distinct(user_id)` filtered to `first_active_date in <period>` (NRU) | #11 |

Payments:

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `new_paying_users` | `count_distinct(user_id)` filtered to `first_recharge_date in <period>` | #25 |
| `rev_new_paying_users` | `sum(charged_value)` for NPU on first-recharge date | #26 |
| `new_register_and_paying_users` (NNPU) | `count_distinct(user_id)` where `first_active_date = first_recharge_date in <period>` | #28 |
| `rev_new_register_and_paying_users` | `sum(charged_value)` for NNPU users | #29 |

Retention (per-N cohorts):

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `retained_d{1,7,30}` | join `mf_users` cohort to `active_daily` on `log_date = first_active_date + n` | #31 |
| `paying_retained_d{1,3,7,…}` | same shape on recharge events | #33 |

LTV / ROAS variants:

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `rev_per_install_d{0,1,3,7,…}` | cumulative recharge value per install cohort, partitioned by `n` | #36 |

Concurrency (CCU API output):

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `ccu` | `sum(concurrent_users)` at sample time | #49 |
| `acu` | `avg(concurrent_users)` per hour | #50 |
| `pcu` | `max(concurrent_users)` per hour | #51 |
| `lcu` | `min(concurrent_users)` per hour | #52 |

Roles:

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `new_roles` | `count_distinct(role_id)` first-active in period | #41 |
| `active_roles` | `count_distinct(role_id)` active in period | #42 |
| `new_paying_roles` | `count_distinct(role_id)` first-recharge in period | #43 |
| `paying_roles` | `count_distinct(role_id)` recharged in period | #44 |

Trailing / WTD / MTD:

| Measure | Suggested SQL | Doc # |
|---|---|---|
| `wau` (calendar week, not trailing) | `count_distinct(user_id)` per ISO week | #14 |
| `trailing_wau` / `trailing_wpu` | `count_distinct(user_id)` where `log_date between week_start and now()` | #45/46 |
| `trailing_mau` / `trailing_mpu` | `count_distinct(user_id)` where `log_date between month_start and now()` | #47/48 |

## ❌ New cube — `funnel`

The 4 CVR metrics (`cvr_install`, `cvr_cdn_download`, `cvr_login_form`,
`cvr_register`) reference a `funnel` cube that doesn't exist. Suggested shape:

```yaml
cubes:
  - name: funnel
    sql_table: funnel_daily
    dimensions:
      - { name: appsflyer_id, type: string, primary_key: true }
      - { name: install_date, type: time }
    measures:
      - name: users_total
        type: count_distinct_approx
        sql: appsflyer_id
      - name: users_completed_install
        type: count_distinct_approx
        sql: appsflyer_id
        filters:
          - sql: '{CUBE}.install_completed = TRUE'
      - name: users_completed_cdn_download   # … same shape per step
      - name: users_completed_login_form
      - name: users_completed_register
```

## ❌ `recharge.gross_bookings_vnd`

`gross_bookings.yml` points at `recharge.gross_bookings_vnd` which doesn't
exist. Per the metric doc, Gross Bookings = `sum(charged_value_before_refund)`
from Billing, which is a different upstream than the existing
`recharge.revenue_vnd` (post-refund, delivery-recognised).

Options:
1. Add a `billing` cube wrapping the billing event stream with `gross_bookings_vnd`.
2. Accept `gross_bookings = revenue_vnd` for wallet-less games and document the divergence for games with wallets.

## How the registry tolerates this today

`game_compatibility.required_cubes` only checks cube *existence* in `/meta`,
not measure existence. The frontend lineage tab renders refs as text. So the
broken refs are invisible until somebody clicks "Open in Explore" — that
sends the ref verbatim into `/cubejs-api/v1/load`, which 400s.

The new `check-metric-drift` script catches all of this before it ships.

## Open questions

- Funnel measure shape — is total-base CVR (each step ÷ users_total) the right denominator, or should we offer step-to-step CVR too?
- Acquisition measures (`installs`, `clicks`, `impressions`) — do they belong on `mf_users` or a separate `mmp_daily` cube? Putting them on `mf_users` requires a wide-row join; a dedicated cube is cleaner but doubles the registry's `required_cubes` for marketing metrics.
- `gross_bookings` divergence — confirm with Billing whether revenue_vnd is acceptable approximation across all 6 games.
