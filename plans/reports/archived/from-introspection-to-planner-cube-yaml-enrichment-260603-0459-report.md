# Cube-dev YAML enrichment — new game_integration tables (6 games)

Date: 2026-06-03 · Catalog `game_integration` (Trino) · Source: live introspection via `cube-dev/examples/trino_introspect.py` · Baseline: `cube-dev/plans/reports/introspection-260522-1747-game-integration-schema-diff.md`

## TL;DR

Since 2026-05-22 the warehouse grew a lot. Three big unmodeled layers now exist in 5 of 6 games:
1. **13 `cons_*` consolidated marts** — pre-aggregated, marketing-attributed reporting tables. `cons_game_key_metrics_daily` alone carries installs, NRU, retention a1–a90, payer counts, revenue split (iap/web), trans, trailing WAU/MAU/QAU **and ad spend (cost_vnd/impressions/clicks)** per campaign-day. This is the single biggest enrichment — it is the canonical reporting layer and nothing in cube-dev exposes it.
2. **Marketing cost + role-level + monthly `std_*`** — `std_marketing_cost_all_channels_by_game` (enables ROAS/CAC/CPI), `std_ingame_role_active|recharge[_daily|_monthly]`, `std_ingame_user_*_monthly`.
3. **muaw graduated** — now has the full `mf_users`/`std_*`/`cons_*` set but cube-dev still only models recharge+funnel for it. Backfill = 1:1 byte-copy of ballistar cubes.

cfm-specific: ~25 in-game event etls. High-confidence picks → 3 new cubes (gameplay match, economy flow, FTUE tutorial). ptg unchanged (still etl-only, no std_/cons_).

## Raw-table taxonomy (verified)

| Prefix | Meaning | Examples |
|---|---|---|
| `etl_ingame_*` | Raw game-log events (1 row/event). Snake_case-typed variant is canonical; concatenated all-bigint variant = raw tdbank dump (skip). | login, logout, recharge, register, + game events |
| `std_ingame_*` | Standardized per-entity rollups (user/role × daily/monthly) | user_active_daily, role_recharge_monthly |
| `std_marketing_cost_all_channels_by_game` | Ad spend by channel/campaign/adset/ad | impression, click, cost_vnd, cost_usd |
| `cons_*` | **Consolidated marts WITH calculation** — pre-aggregated + marketing-attributed; the reporting layer | key_metrics_daily, new_user_retention_daily |
| `mf_*` | Master/feature stores | mf_users (119 cols), mf_ingame_devices/ips/roles |
| `map_*` | Identity bridges | map_ingame_devices_and_userid |

## Coverage matrix (✅ present in Trino · ★ modeled in cube-dev)

| Layer | ballistar_vn | cfm_vn | jus_vn | muaw | pubgm | ptg |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| mf_users | ✅★ | ✅★ | ✅★ | ✅ (not★) | ✅★ | ❌ |
| std_user_active_daily | ✅★ | ✅★ | ✅★ | ✅ (not★) | ✅★ | ❌ |
| std_user_recharge_daily | ✅★ | ✅★ | ✅★ | ✅ (not★) | ✅★ | ❌ |
| std_user_*_monthly | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| std_role_active/recharge[_daily/_monthly] | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| std_marketing_cost | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(only this+etls) |
| **cons_* (13 marts)** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| etl_ingame_recharge | ✅★ | ✅★ | ✅★ | ✅★ | ✅★ | ✅★ |
| cfm in-game event etls (~25) | — | ✅ | — | — | — | — |

None of the `cons_*`, monthly/role `std_*`, `std_marketing_cost`, `map_*`, or cfm-event tables are modeled in any game.

## Proposed YAML changes (phased)

### Phase 1 — `cons_game_key_metrics_daily` cube ×5 (highest ROI)
New cube `game_key_metrics` (sql_table `cons_game_key_metrics_daily`) in ballistar/cfm/jus/muaw/pubg.
- time dims: `report_date` (day), `report_month`; attribution dims: media_source, campaign_id, adset_id, ad_id, country_code, platform, is_paid_install, product_code.
- measures (all `sum` over pre-agg'd cols — additive): installs, nru, npu, rev, iap_rev, web_rev, trans, cost_vnd, impressions, clicks; derived (`number` from sub-measures): cpi=cost/installs, roas=rev/cost, arpu=rev/a1, payer_rate=npu/nru, retention a1/a7/a30 ratios, trailing_wau/mau.
- Identical shape across games → author once, copy 4×, retitle.

### Phase 2 — marketing cost cube ×5 (+ ptg)
New cube `marketing_cost` (sql_table `std_marketing_cost_all_channels_by_game`). Spend grain finer than cons (has account_id, campaign_name, adset_name). Enables CAC when no cons join needed. ptg can take this one even though it lacks std_/cons_.

### Phase 3 — backfill muaw to full set
Copy ballistar `mf_users.yml`, `active_daily.yml`, `user_recharge_daily.yml`, `retention.yml` → `cubes/muaw/`, retitle "MUAW", confirm shared shape (verified identical in baseline). muaw recharge.yml already exists (custom). Optionally add muaw `views/`.

### Phase 4 — retention curve cube ×5
New cube `new_user_retention` (sql_table `cons_game_new_user_retention_daily`): nru + rnru_01..1080 cohort retention + ranpu/rpnpu payer-retention. Powers cohort-curve charts directly (no event scan).

### Phase 5 — cfm in-game event cubes (3 high-confidence)
- `gameplay_match` ← `etl_ingame_game_detail` (curated ~20 of 282 cols: user=playeropenid/playerid, gamemode, mapid, gameresult, kills/score/duration). Measures: matches, win_rate, avg_kills, K/D, avg_duration.
- `economy_flow` ← `etl_ingame_moneyflow` (vopenid, imoneytype, delta, reason/subreason, balance). Measures: currency_in, currency_out, net_flow by reason — currency sources/sinks.
- `onboarding_tutorial` ← `etl_ingame_newbietutorial` (vopenid, tutorialid, tutorialstatus). Measures: tutorial completion funnel / FTUE drop-off.
- (stretch) `matchmaking` ← `etl_ingame_room_match_flow` (wait times, result) for matchmaking-health.
- All join `mf_users` via `vopenid = mf_users.user_id`. Use snake_case typed variants, NOT the `roommatchflow`/`roomactionflow` raw dumps.

### Conventions to follow (from existing cubes)
- Date cols → `from_iso8601_timestamp(CAST({CUBE}.<col> AS VARCHAR) || 'T00:00:00Z')` for `type: time`.
- Composite PK via `CONCAT(...)` `public: false` for non-unique-row cubes.
- `refresh_key: every: 30 minute` (event/daily) or `1 hour` (cons marts are daily-updated → 1 hour fine).
- Add `pre_aggregations` rollups for cons cubes (report_date day, partition month) — they are the BI hot path.

## Sync / git plan

Sibling `/Users/lap16299/Documents/code/cube-dev` already has `origin = git@github.com:khoIT/metrics-catalogue.git` (+ a `gitlab` mirror remote). In-repo `cube-playground/cube-dev/` is a **plain copy, not a submodule**. Options to sync (decision needed):
- **A. git submodule** — `git submodule add git@github.com:khoIT/metrics-catalogue.git cube-dev` after removing the vendored copy from cube-playground's index. Pin to a commit; `git submodule update --remote` to pull. Cleanest provenance.
- **B. subtree** — `git subtree pull --prefix=cube-dev origin main`. No `.gitmodules`, history squashed in.
- **C. rsync script** — keep the plain copy, add `scripts/sync-cube-dev.sh` mirroring sibling→in-repo. Simplest, no git plumbing, but no provenance.

Authoring happens in sibling `/cube-dev` (committed + pushed to metrics-catalogue), then synced into cube-playground via the chosen mechanism.

## Validation per phase
- `node --check cube/cube.js` (unchanged unless GAME_SCHEMA touched — it isn't).
- YAML parse each file (`ruby -ryaml` or python yaml).
- Live `GET :4000/meta` (mint JWT or dev token) to confirm cube compiles + measures resolve.
- Spot-query `:3004/cube-api/v1/load` for one measure per new cube.

## Open questions
1. **Scope/priority** — build all 5 phases, or start with Phase 1 (cons_key_metrics) + Phase 3 (muaw backfill) as the highest-value slice? (Authoring all 5 = ~35–45 YAML files.)
2. **Sync mechanism** — submodule (A), subtree (B), or rsync script (C)?
3. **cons currency** — `cost_vnd` vs `cost`/`cost_usd`; confirm VND is the reporting standard (same open Q as recharge currency in baseline report).
4. **cfm gameplay scope** — `game_detail` is 282 cols; confirm the ~20-col curated subset is enough or which extra stats matter to analysts.
5. **ptg** — leave etl-only, or also model its `etl_ingame_money_flow`/`ccu`/`item_log` as standalone economy/concurrency cubes?
