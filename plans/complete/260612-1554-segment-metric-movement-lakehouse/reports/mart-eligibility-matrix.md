# Per-Game Mart Eligibility Matrix — Segment Metric-Movement (membership@day ⨝ fact@day)

Generated 2026-06-12 (GMT+7). Read-only Trino probes against `game_integration.*`; membership source `stag_iceberg.khoitn.segment_membership_daily` (only partition: `snapshot_date = 2026-06-10`; games present: ballistar / cfm_vn / jus_vn).

## TL;DR

- Every game schema ships the SAME two per-user daily marts: `std_ingame_user_active_daily` (activity + playtime) and `std_ingame_user_recharge_daily` (revenue). Uniform columns: `user_id varchar`, `log_date date`, metrics below.
- **cfm_vn: revenue + activity marts both VERIFIED eligible (join probes PASS).** ✅
- **jus_vn: revenue + activity marts both VERIFIED eligible** (activity probe PASS same-day; recharge join mechanism verified via 30-day window — same-day 0 is payer sparsity in a 224-member segment, not a namespace fail). ✅
- ballistar: both marts VERIFIED eligible (probes PASS) — but only ~5 weeks of history (min log_date 2026-05-07).
- muaw / pubgm: schema + grain OK, **no probe possible yet** (no membership rows).
- ptg: marts exist but STALE — data ends 2023-08-31, zero rows on probe date → ineligible.

## Matrix

| Game (schema) | Mart | uid col + namespace | date col (type) | metric_keys supportable | Grain (rows vs uids @2026-06-10) | Join probe | Retention (min→max log_date) | Immutability | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| cfm_vn | std_ingame_user_active_daily | `user_id` — same ns as membership uid (direct match) | `log_date` (date) | active (row-presence), playtime (`total_online_time` bigint sec), dau | 180,950 = 180,950 ✓ | **PASS** 3,646 joined / 3,968 members (seg `1d76e4bb`) | 2025-12-16 → 2026-06-12 | UNKNOWN | **eligible** |
| cfm_vn | std_ingame_user_recharge_daily | `user_id` — same ns (direct match) | `log_date` (date) | revenue (`ingame_total_recharge_value_vnd` double, also `_usd`, `_transaction_id`) | 1,475 = 1,475 ✓ | **PASS** 1,471 joined (seg `5ee78131`, 7.16M members ∩ 1,475 payers that day) | 2025-12-16 → 2026-06-12 | UNKNOWN | **eligible** |
| jus_vn | std_ingame_user_active_daily | `user_id` — suffixed ns `<id>@vng_vie.win.163.com`; membership uid carries SAME suffix → direct match | `log_date` (date) | active, playtime, dau | 32,694 = 32,694 ✓ | **PASS** 9 joined / 224 members (seg `a18465f3`; low = only 9 members active that day) | 2025-11-05 → 2026-06-11 | UNKNOWN | **eligible** |
| jus_vn | std_ingame_user_recharge_daily | `user_id` — same suffixed ns, direct match | `log_date` (date) | revenue (vnd/usd/txn) | 1,858 = 1,858 ✓ | **PASS (windowed)** same-day = 0 joined; 30-day window (05-12→06-10) = 44 distinct member uids matched → join valid, same-day 0 = payer sparsity | 2025-11-05 → 2026-06-11 | UNKNOWN | **eligible** |
| ballistar (ballistar_vn) | std_ingame_user_active_daily | `user_id` — direct match | `log_date` (date) | active, playtime, dau | 40,136 = 40,136 ✓ | **PASS** 3,869 joined / 7,829 members (seg `bdcde5e6`) | 2026-05-07 → 2026-06-11 (**~5 weeks only**) | UNKNOWN | **eligible** |
| ballistar (ballistar_vn) | std_ingame_user_recharge_daily | `user_id` — direct match | `log_date` (date) | revenue (vnd/usd/txn) | 540 = 540 ✓ | **PASS** 456 joined (same seg) | 2026-05-07 → 2026-06-11 | UNKNOWN | **eligible** |
| muaw | std_ingame_user_active_daily | `user_id` (varchar; ns unverified — no membership) | `log_date` (date) | active, playtime | 27,085 = 27,085 ✓ | no probe possible yet (no membership rows) | 2025-04-03 → 2026-06-12 | UNKNOWN | eligible-pending-probe |
| muaw | std_ingame_user_recharge_daily | `user_id` | `log_date` (date) | revenue | 3,205 = 3,205 ✓ | no probe possible yet | 2025-04-03 → 2026-06-11 | UNKNOWN | eligible-pending-probe |
| pubgm | std_ingame_user_active_daily | `user_id` | `log_date` (date) | active, playtime | 476,330 = 476,330 ✓ | no probe possible yet | 2026-01-01 → 2026-06-12 | UNKNOWN | eligible-pending-probe |
| pubgm | std_ingame_user_recharge_daily | `user_id` | `log_date` (date) | revenue | 8,184 = 8,184 ✓ | no probe possible yet | 2026-01-01 → 2026-06-12 | UNKNOWN | eligible-pending-probe |
| ptg | std_ingame_user_active_daily | `user_id` | `log_date` (date) | — | 0 rows on 2026-06-10 | n/a (no membership, no current data) | 2022-06-30 → **2023-08-31 (stale)** | UNKNOWN | **ineligible (stale)** |
| ptg | std_ingame_user_recharge_daily | `user_id` | `log_date` (date) | — | 0 rows on 2026-06-10 | n/a | 2022-06-30 → **2023-08-31 (stale)** | UNKNOWN | **ineligible (stale)** |

All 12 grain checks where data existed returned `count(*) = count(distinct user_id)` ⇒ strict per-user-per-day grain, no dedupe needed anywhere.

## Cube YAML citations (shortlisted marts)

Identical cube structure cloned per game; `sql_table` resolves under each game's `CUBEJS_DB_SCHEMA`.

| Cube | sql_table | uid dim | date dim | key metric |
|---|---|---|---|---|
| cfm active_daily | `cube-dev/cube/model/cubes/cfm/active_daily.yml:3` | `:31` (`user_id`) | `:35` (`log_date`) | `:127` (`total_online_time_sec` sum), `:103` (`dau`) |
| cfm user_recharge_daily | `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml:12` | `:34` | `:38` | `:117` (`revenue_vnd_total` sum of `ingame_total_recharge_value_vnd`) |
| jus active_daily | `cube-dev/cube/model/cubes/jus/active_daily.yml:3` | `:31` | `:35` | `:127`, `:103` |
| jus user_recharge_daily | `cube-dev/cube/model/cubes/jus/user_recharge_daily.yml:12` (note `:22` mf_users join via `split_part(user_id,'@',1)`) | `:34` | `:38` | `:117` |
| ballistar active_daily | `cube-dev/cube/model/cubes/ballistar/active_daily.yml:3` | `:31` | `:35` | `:127`, `:103` |
| ballistar user_recharge_daily | `cube-dev/cube/model/cubes/ballistar/user_recharge_daily.yml:12` | `:34` | `:38` | `:117` |
| muaw active_daily / user_recharge_daily | `cubes/muaw/active_daily.yml:3` / `cubes/muaw/user_recharge_daily.yml:12` | `:31`/`:34` | `:35`/`:38` | `:127`/`:117` |
| pubg active_daily / user_recharge_daily | `cubes/pubg/active_daily.yml:3` / `cubes/pubg/user_recharge_daily.yml:12` | `:31`/`:34` | `:35`/`:38` | `:127`/`:117` |
| ptg recharge (only ptg cube w/ table) | `cube-dev/cube/model/cubes/ptg/recharge.yml:32` (`etl_ingame_recharge`, event-level) | `:48` | — | — |

## Shortlist exclusions (why NOT in matrix)

- **mf_users** (`cubes/cfm/mf_users.yml:3`, `cubes/ballistar/mf_users.yml:3`, jus derived-SQL `cubes/jus/mf_users.yml:84` for user_id) — current-state stock attributes, NOT a daily fact; no date-grain history. Useful only for stock dims at join time.
- **user_gameplay_daily** (cfm/jus, `cubes/cfm/user_gameplay_daily.yml:32` `sql:` block) — derived cube anchored to `MAX(log_date)` of `etl_ingame_game_detail`; one row per player AS OF anchor day, trailing-4-day window. Not a daily history mart → cannot do membership@day ⨝ fact@day across dates.
- **user_active_rolling / user_recharge_rolling** (`cubes/cfm/user_recharge_rolling.yml:23` etc.) — derived anchor-day snapshots computing rolling 1d/7d/30d over the SAME std marts already in the matrix. Redundant for movement; anchor-only grain.
- **user_recharge_monthly / user_active_monthly** (cfm) — monthly grain, not daily.
- **etl_* event tables** (recharge, login, game_detail…) — transaction/event grain; would be eligible-with-dedupe (aggregate-to-day first) but std daily marts supersede them for every game except ptg (whose data is stale anyway).

## Identity namespace findings

- Membership `uid` = the segment's resolved identity dimension (`server/src/services/resolve-identity-field.ts` — manual `cube_identity_map` override wins, else auto-suggester ≥0.7 confidence; values stored logical-space, re-physicalized per workspace prefix).
- **cfm_vn**: membership uid matches std-mart `user_id` directly (probe-proven). Per ground truth: use `user_recharge_daily`, NOT raw `recharge` (vopenid namespace handled via std bridge); `iamount` is NOT VND — the std mart's `ingame_total_recharge_value_vnd` is the correct revenue column.
- **jus_vn**: BOTH membership uid and std-mart `user_id` carry the `@vng_vie.win.163.com` suffix → direct join correct. The `split_part(user_id,'@',1)` in the YAML is only for joining to mf_users (bare ids). **Trap**: a future jus segment defined on mf_users would snapshot BARE uids → raw-mart join then needs `m.uid = split_part(f.user_id,'@',1)`. Movement-join SQL should be per-segment-identity-aware, not hardcoded.
- **ballistar**: direct match, no suffix games.

## Per-game one-liners

- **cfm_vn** — DEMO-READY: revenue (user_recharge_daily) + activity/playtime (active_daily) both probe-verified eligible; ~6 months retention.
- **jus_vn** — DEMO-READY: both marts eligible; recharge same-day overlap can be 0 for tiny segments (224 members) — UI should tolerate sparse payer days; ~7 months retention.
- **ballistar** — eligible both marts, probes PASS; CAUTION only ~5 weeks of mart history (min 2026-05-07) limits long baselines.
- **muaw / pubgm** — structurally identical, grain ✓; no membership snapshots yet → no probe possible yet.
- **ptg** — marts frozen at 2023-08-31; only cube model is event-level `etl_ingame_recharge`; ineligible until upstream resumes.

## Demo-game callout

**YES** — cfm_vn AND jus_vn each have ≥1 revenue mart (`std_ingame_user_recharge_daily`) and ≥1 activity mart (`std_ingame_user_active_daily`) verified eligible with join probes.

## Unresolved questions

1. Immutability: are std_* mart historical partitions append-only or restated upstream? No evidence either way (UNKNOWN everywhere). cfm/jus max log_date includes today (2026-06-12) → current-day partition is definitely mutable intra-day; movement jobs should lag ≥1 day.
2. ballistar 2026-05-07 floor: launch date or rolling retention window? If rolling ~36d, baselines for movement (e.g. 30d prior) will fall off the edge.
3. jus future segments defined on mf_users (bare uid) would break the direct join — should the membership snapshot job normalize jus uids, or should movement SQL carry per-segment namespace mapping?
4. Membership snapshot has a single partition (2026-06-10) — movement requires ≥2 snapshot days; verify nightly job cadence before wiring metric-movement queries.
