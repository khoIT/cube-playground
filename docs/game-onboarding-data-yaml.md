# Game Onboarding — Data YAML Guide

What Cube YAML a new game needs so the playground's data surfaces light up. Organized by **use case**: each surface lists the cubes/views/members it consumes, so onboarding a game = porting the canonical reference set into the game's `cubes/` + `views/` folders.

## Mechanics (read once)

- **Where YAML lives:** `cube-dev/cube/model/cubes/<game>/*.yml` (cubes) and `cube-dev/cube/model/views/<game>/user_360.yml` (views). Local cube mounts `./cube-dev/cube`.
- **Game key → Trino schema** is mapped in `cube-dev/cube/cube.js` `GAME_SCHEMA` (e.g. `jus → jus_vn`, `cfm → cfm_vn`). `sql_table:` names are bare table names; the schema is injected per-request from the JWT.
- **Shared wide-table schema.** `game_integration.<schema>.{mf_users, mf_ingame_roles, std_ingame_user_recharge_daily, std_ingame_user_active_daily, etl_ingame_item_flow, …}` have the **same columns across games** — a column existing ≠ being populated (see lessons-learned: all-NULL columns). Verify population with a Trino `count(col)` before ranking/qualifying on it.
- **No hot-reload.** Local runs `DEV_MODE=false`. After adding/editing YAML, restart **both** `cube_api` and `cube-refresh-worker`, then re-probe `/meta`.
- **Canonical reference:** `cfm` is the most complete game — when onboarding, diff the target game's `cubes/<game>/` and `views/<game>/user_360.yml` against `cfm`'s and port what's missing.

---

## Use case: CS Dashboard (VIP-care playbooks)

The CS dashboard (`/#/dashboards/cs/queue`) runs 21 shared playbooks. The **registry is game-agnostic** (`server/src/care/playbook-registry.ts`); each game's verdict is computed per-game from live `/meta` member presence (`server/src/care/availability.ts`). A mart that exposes a logical member named exactly as a playbook's `dataRequirements` flips that game's verdict — **zero registry edits**. Availability fails CLOSED (absent member → `unavailable`, no query).

### Tier 0 — identity & profile (REQUIRED before any playbook is useful)

These are **not** playbook requirements and are **invisible to the availability check** — a game can show every playbook "available" and still render raw uids / blank profiles if Tier 0 is missing. The profile fetcher (`server/src/care/care-vip-profile-fetch.ts`) queries these two views by name:

| View (in `views/<game>/user_360.yml`) | Backing cube | Members the fetcher reads | Supplies |
|---|---|---|---|
| `user_profile` | `mf_users` | `user_id, ltv_vnd, payer_tier, days_since_last_active, last_recharge_date` | VIP enrichment (LTV, tier, recency) on every queue row |
| `user_roles_panel` | `user_roles` (`sql_table: mf_ingame_roles`) | `user_id, last_role_name, max_role_level` | **Player display name** — the in-game character name shown in the queue / member360. Absent → queue falls back to raw uid. |

> **The jus_vn hurdle (2026-06-10):** jus had `user_profile` but no `user_roles` cube and no `user_roles_panel` view, so the queue showed uids (`…@vng_vie.win.163.com`) instead of character names. Fix = port `cfm/user_roles.yml` → `jus/user_roles.yml` and append the `user_roles_panel` view block to `jus/user_360.yml`. Note the fetcher queries the **view** (`user_roles_panel`), not the cube — both pieces are needed. Names live in `mf_ingame_roles.ingame_last_active_role_name` (~100% populated). After the YAML lands, existing stored profiles keep `name = NULL` until a profile refresh / sweep re-runs.

### Tier 1 — playbook coverage marts (one member → one verdict flip)

| PB | Name | `dataRequirements` member | Source mart / table | Notes |
|----|------|---------|---------|-------|
| 01 | First deposit | `mf_users.first_recharge_date` | `mf_users` (baseline) | Tier-0 covers it |
| 02 | VIP tier | `mf_users.ltv_total_vnd` | `mf_users` | confirm tier threshold suits the game's scale |
| 03 | Spend spike | `user_recharge_rolling.spike_ratio` | `std_ingame_user_recharge_daily` | rolling mart |
| 04 | Spend drop | `user_recharge_rolling.qualified_drop_ratio` | `std_ingame_user_recharge_daily` | rolling mart |
| 06 | Top leaderboard | `user_gameplay_daily.ladder_rank` (≤10) | game-specific | rank metric varies per game (PvP score vs progression+LTV) |
| 07 | Rare unlock | `etl_prop_flow.prop_id` | `etl_ingame_item_flow` | raw event → **partial** (drill-down, no cohort sweep) |
| 09 | Major achievement | `user_gameplay_daily.ladder_rank` (==1) | game-specific | shares 06's mart |
| 11 | Collector FOMO | `etl_prop_flow.prop_id` | `etl_ingame_item_flow` | shares 07's member → **partial** |
| 14 | No login ≥ N days | `mf_users.days_since_last_active` | `mf_users` | Tier-0 covers it |
| 15 | Session-time drop | `user_active_rolling.qualified_session_ratio` | `std_ingame_user_active_daily` | rolling mart |
| 18 | Anniversary | `mf_users.first_active_date` | `mf_users` | Tier-0 covers it |
| 19 / 20 | Ops-driven | — (ops calendar) | `ops_calendar` | partial unless ops data modeled |
| 05, 08, 10, 12, 13, 16, 17, 21 | — | payment-fail / rank-drop / clan / gacha / sentiment / ticket / birthday | not modeled in any game | leave unavailable — **no fabrication** |

### Onboarding checklist for a new game's CS dashboard

1. **Map the schema** — add `<game>: <trino_schema>` to `GAME_SCHEMA` in `cube.js` if missing.
2. **Tier 0** — ensure `user_profile` + `user_roles_panel` views exist in `views/<game>/user_360.yml`, backed by `mf_users` and a `user_roles` cube. Port from `cfm` verbatim; adjust title/description only.
3. **Tier 1** — port the rolling/gameplay/prop marts you have a populated source for. Skip anything whose source column is all-NULL (probe Trino first) or absent — leave the playbook unavailable rather than emit a garbage member (a garbage member falsely flips the verdict).
4. **Restart** `cube_api` + `cube-refresh-worker`.
5. **Verify** (recipe below).
6. **Refresh profiles** so the queue picks up names/enrichment for already-open cases (a sweep or targeted profile refresh; `upsertVipProfiles`).

### Verify recipe (per game)

- `/meta` includes each new cube/view: mint a JWT `{game}` and `GET /cubejs-api/v1/meta`, or use the server's `getMetaWithCtx(ctx)`.
- `/load` returns plausible rows for each new member (non-empty, non-degenerate — e.g. `ladder_rank ≤ 10` returns ~10, not the whole base).
- Profile fetcher resolves names: `makeCubeProfileFetcher(ctx, game, ws.id)(sampleUids)` → `name` non-null.
- Cohort sweep: `executeSweep` → each available playbook opens a sane cohort.

> Trino is reachable from inside the `cube-api` container (VPN route); the host cannot reach it directly. Probe with the container's `CUBEJS_DB_*` env (Basic auth over TLS, port 8080) — never print the password.

---

## Other use cases (pointers)

- **Cohort retention dashboard** → `docs/cohort-retention-cube-template.md`
- **Ordered funnel** → `docs/ordered-funnel-cube-template.md`
- **Metric ↔ cube coverage** (which metric YAMLs have no backing member) → coverage monitor + Settings tab.

## Unresolved questions

- None for the CS-dashboard onboarding path. Per-game tuning (VIP-tier LTV threshold, leaderboard rank metric) is a calibration decision, surfaced to the game owner — not a YAML blocker.
