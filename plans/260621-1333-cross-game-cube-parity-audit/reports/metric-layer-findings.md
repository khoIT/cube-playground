# Metric-layer parity findings (Phase 3)

Source: `npm run audit:metric-trust` (server) — 8 games, 73 metrics each.
Totals: **certified 425 · ready 0 · gap 129 · n/a 30**.
GAP = metric YAML references a cube member that resolves in NO dev cube (the documented "ref exists in no cube" bug class).

## GAP families (root-caused by source table)

| Family / cube ref | Missing members | Source table in dev? | Class |
|-------------------|-----------------|----------------------|-------|
| `active_daily` online-time | avg_online_time_min_per_dau, total_online_time_hrs | exists (active_daily) | **FIXABLE** — add measures to canonical active cube |
| `active_daily` WAU/trailing | wau, trailing_wau, trailing_mau | exists | **FIXABLE** — known gap ([[mf-users-missing-wau-trailing-measures]]); generator |
| `recharge` paying | paying_rate, paying_users | exists (recharge) | **FIXABLE** — add to recharge cube |
| `user_recharge_daily` trailing | trailing_mpu, trailing_wpu | exists | **FIXABLE** — generator |
| `mf_users` paying-role | paying_role, new_paying_role | exists where mf_users present | **FIXABLE** where mf_users modeled; N/A for ptg (no mf_users) |
| `etl_lottery_shoot` gacha | gacha_pulls, gacha_players, gacha_diamond_cost | **absent** most games | **BLOCKED → N/A** |
| `etl_money_flow` economy | diamond_net_delta, diamond_spend_events, economy_spenders | per-game (jus has it) | **BLOCKED → N/A** where money_flow absent |
| `etl_newbie_tutorial` | tutorial_completions, tutorial_starters, tutorial_completion_rate | **absent** | **BLOCKED → N/A** |
| `funnel` cvr | cvr_install, cvr_login_form, cvr_register, cvr_cdn_download | **absent** | **BLOCKED → N/A** |

## Split

- **FIXABLE GAPs** (source exists, measure just unmodeled): online-time, WAU/trailing, recharge paying, user_recharge_daily trailing, mf_users paying-role. Mostly **canonical-cube → generator** edits → close across many games at once. These overlap the Phase-1 §B measure-parity backfill (same canonical cubes).
- **BLOCKED → N/A** (source table absent for that game): gacha, tutorial, funnel, money_flow-where-absent. NOT cube fixes — set `meta.applicability: n/a` per game in the business-metric YAML so they leave the GAP bucket. The metric-trust tool already buckets 30 as n/a; these ~ raise that.

## Cross-checks (per plan)
- **Glossary integrity / chat-seed member resolution:** not re-run live this pass (needs running server + `/meta`). Prior state recorded in [[glossary-metric-ref-integrity]] (churn_rate dangling-ref fix shipped). Re-validate during Phase 6 live spot-check.
- **Certified baseline:** 425/584 applicable ≈ matches playbook ~72.8% certified snapshot — no regression detected.

## Unresolved questions
1. Which FIXABLE GAP measures are genuinely wanted vs deprecated-by-design? (trailing_* were deprioritized before — owner call, gates backfill.)
2. Confirm per-game source-table absence for gacha/tutorial/funnel before mass-marking N/A (cheap `presentTables` probe) — avoid marking N/A a game that actually has the table.
