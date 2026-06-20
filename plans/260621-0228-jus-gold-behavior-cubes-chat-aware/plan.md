# jus_vn Gold Behavior Cubes + Chat-Service Awareness

Build the missing "gold" Cube models for `jus_vn` (a farming/MMO genre game) so the
chat-service diagnose/advise rail can cross from *what happened* (money) to *why*
(behavior), then make those cubes discoverable + queryable per game. Pattern
generalizes to every game (jus is the first concrete instance).

## Context
- Source: `game_integration.jus_vn.*` (Trino). Verified schemas + samples 2026-06-21.
- Mirror patterns from `cube-dev/cube/model/cubes/cfm/*.yml`.
- Target output: `cube-dev/cube/model/cubes/jus/*.yml`.
- Identity model: events key on `role_id` → bridge `user_roles` (`mf_ingame_roles`) → hub `mf_users`. `many_to_one` joins, declared at cube level (cfm `etl_login.yml:14`, `user_roles.yml:16`).
- Reports: `plans/reports/` · Branch: `main` (commit direct).

## Locked decisions (user, 2026-06-21)
1. Reason/currency code dictionaries are **per-game** — do NOT port cfm's codes.
2. money_flow/item_flow May-15 freeze is **upstream lag**, data will catch up — model now, don't gate on it.
3. **Role grain** is the default for new cubes, with user-grain rollups via the bridge.

## Verified data facts that shape the build
| Table | Rows | Coverage | Note |
|---|---|---|---|
| `etl_ingame_money_flow` | 2.8B | 2025-11→2026-05-15 (lag) | `field`=30 currency codes, `reason`=225 codes, `reason_remarks`=4 coarse codes; `num` always +, gain/spend NOT encoded → dictionary must classify credit/debit. `log_type` always NULL. |
| `etl_ingame_item_flow` | 3.6B | →2026-05-15 (lag) | already `etl_prop_flow.yml`; `reason` numeric, unlabeled. |
| `etl_ingame_login`/`logout` | 225M ea | →today | vip_level→15, role_level cap 69, 8 role_class, fighting_power, guild_id, online_time (p50 7.6m/p90 57m). |
| `etl_ingame_register` | 3.6M | →today | born_server, is_guest, class/gender at creation. |
| `etl_ingame_garden_farm_crop_harvest` | 20.7M | 2026-06-09→today | genre signature; crop_level peaks at 11 (7.5M/wk, 8.4K roles). **~2wk window only.** |
| `etl_ingame_npc_im_tour` | 129K | 2026-06-09→today | genre signature; 18 NPCs, `is_enter` flag, `role_grade`. **~2wk window only.** |
| `std_ingame_role_active_daily` | — | →today | rich role×day fact: `total_online_time`, role_class, level min/max, `is_recharge`, server/channel/country. **Unused today.** |
| `std_ingame_role_recharge_daily` | — | →today | role×day recharge: vip, product, vnd/usd, txn counts. **Unused today.** |
| `std_ingame_garden…` / `std_ingame_npc…` | — | →today | presence-only (`role_id, log_date`) → feature-DAU only; depth needs raw etl. |

## Phases
| Phase | Title | Status | Blocker |
|---|---|---|---|
| [01](phase-01-role-grain-foundation.md) | Role-grain foundation (role_active_daily + role_recharge_daily) | ✅ done | none |
| [02](phase-02-genre-engagement-cubes.md) | Genre engagement loops (etl_garden_harvest + etl_npc_im_tour) | ✅ done (ported) | none |
| [03](phase-03-session-and-acquisition.md) | Session/progression + acquisition (etl_login/etl_logout + etl_register) | ✅ done (ported) | none |
| [04](phase-04-virtual-currency-economy.md) | Virtual-currency economy (etl_money_flow) | ✅ done (no dict needed) | resolved |
| [05](phase-05-chat-service-awareness.md) | Chat-service awareness + verification | ✅ done | — |

## OUTCOME (2026-06-21) — material deviation from original plan
Checked the kraken/cube GitLab upstream (`cube-prod` clone, `origin/main`) per user request and it **already had 5 of the planned jus_vn cubes**: `etl_garden_harvest`, `etl_npc_im_tour`, `etl_login`, `etl_logout`, `etl_register`. So Phases 02–03 became **port** (translate prefixed `jus_vn__*` → bare local names) instead of author-from-scratch. This also overturned two original-plan assumptions:
- **No role bridge needed** — these event tables carry `account_id` (= `mf_users.user_id`, NetEase URS) and join *directly* to `mf_users` (upstream verified 100–200/200 match). `role_id`→`user_roles` is a secondary character-level join. (Original plan's mandatory `role_id`→`user_roles`→`mf_users` bridge was wrong for events.)
- **No rollups** — upstream serves 218M/2.8B tables via a query-bound + 30-min `refresh_key` + segments, not pre-aggregations. Dropped the rollup mandate.

**Phase 04 unblocked without a dictionary.** The cfm `docs/CFL_Game detail 2.xlsx` cited in cfm YAMLs was never committed (no repo artifact, no jus equivalent). The upstream convention (jus `etl_npc_im_tour`, omg `etl_money_flow`) is explicit: **raw codes are NOT labeled when no enum doc exists, and direction is only exposed when a verified column carries it.** jus `etl_ingame_money_flow` has `account_id` (direct join), `num` (always +), `now_num` (balance), but **no direction flag** — so `etl_money_flow.yml` exposes raw `field`/`reason`/`reason_remarks` + `total_value` (sum) + `balance_after`, and does NOT fabricate a credit/debit split.

**8 cubes built + verified** (all live in jus `/meta` with time dims, all return real rows via bounded `/load`):
`etl_garden_harvest`, `etl_npc_im_tour`, `etl_login`, `etl_logout`, `etl_register` (ported), `role_active_daily`, `role_recharge_daily` (net-new role grain), `etl_money_flow` (net-new, honest).

**`log_date` wrap fix:** raw `date` `log_date` typed `time` passed normal `/load` but failed the knowledge-seed coverage probe (*"value must be a time or timestamp (actual date)"*). Fixed by wrapping to `from_iso8601_timestamp(CAST(... AS VARCHAR)||'T00:00:00Z')` (the production cfm pattern). Empirically re-verified partition pruning survives: 1-day window on 2.8B-row money_flow returns in ~25s cold (not a full scan).

## Sequencing rationale
- 01 first: highest ROI / zero blockers — unlocks role grain + session time + class/level/VIP instantly from fresh `std_` marts.
- 02 next: genre-defining, cheap, fresh data (disclose 2-week window).
- 03: fills progression + acquisition; big raws → rollups mandatory.
- 04 last among builds: highest payoff but gated on the per-game dictionary doc; data lag is fine (decision #2).
- 05 runs after cubes exist; partially per-phase (verify each cube in `/meta`) then a final knowledge-seed regen + diagnose/advise smoke test.

## Cross-cutting build conventions (apply every phase)
- Cube title: `JUS VN — <Name> (<category>, <local/zh>)`; description carries join chain + size warning + dictionary doc ref + refresh cadence (cfm `etl_money_flow.yml` header).
- Composite `primary_key` (`public: false`) = concat of identity + date/event keys.
- PII dims (`device_id`, `client_ip`, `imei`, …) → `public: false`.
- DAU/payer counts = `count_distinct_approx`; in/out splits = filtered measures.
- Big tables (>100M): rollup → `rollup_lambda` union (`union_with_source_data: true`) + a `dteventtime`-keyed twin where queries bind on event time. Cap `build_range_end` at `current_timestamp`.
- **Never** name a chat-visible cube `std_*` (chat strips `std_`-prefixed cubes from `/meta`).

## Verification harness (reused across phases)
- `node scripts/trino-query.mjs "<SQL>"` — source-data probes.
- `cube-dev/scripts/probe-preagg-routing.py` — assert rollup routing.
- `/cube-api/v1/meta` with `x-cube-workspace: local`, `x-cube-game: jus_vn` — confirm cube + members exposed.
- chat smoke: `/diagnose`, `/explore` turns against jus_vn.

## Open questions (post-build)
1. **RESOLVED** — there is no committed jus (or cfm) code-dictionary artifact, and the upstream convention is to NOT fabricate labels. `etl_money_flow` ships with raw codes. If/when a real jus currency/reason dictionary surfaces, add `case:` label dims + a verified credit/debit `direction` to `etl_money_flow.yml`.
2. **Optional enhancement** — derive `etl_money_flow` direction from per-role `now_num` balance deltas (window op) and validate the sign, the way omg verified its `golddirection`. Deferred (expensive on 2.8B rows; not needed for the diagnostic value the cube already provides).
3. money_flow/item_flow data still ends 2026-05-15 (upstream lag, decision #2) — recent windows read empty without error; cube description discloses it. Revisit once upstream backfills.
