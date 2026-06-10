# jus_vn CS queue showed uids — missing identity view, not missing data

**Date:** 2026-06-10 (GMT+7) · **Surface:** CS dashboard queue (`/#/dashboards/cs/queue?game=jus_vn`)

## Symptom
jus_vn queue rows showed raw uids (`…@vng_vie.win.163.com`); cfm_vn showed in-game character names. User asked "does jus_vn have usernames?"

## Root cause
The queue display name is **not** the account login — it's `last_role_name` (highest-level character), pulled by the VIP profile fetcher (`care-vip-profile-fetch.ts`) from the `user_roles_panel` **view** over a `user_roles` cube. jus had neither the cube nor the view (only cfm/cros/tf did). Role query returned empty → `name = NULL` → UI fell back to uid.

The trap: this dependency is **invisible to the availability check**. All jus playbooks reported "available" (their `dataRequirements` members existed from the coverage-unlock work the day before), but the profile fetcher queries the identity view *unconditionally* — outside the availability gate. So the surface degraded silently with zero errors.

Data was never the problem: `game_integration.jus_vn.mf_ingame_roles.ingame_last_active_role_name` is **1,689,402 / 1,689,403 rows populated** (~100%), 985k distinct names. Just unmodeled.

## Fix
Mirror cfm verbatim (same shared wide-table schema; verified all 25 referenced columns exist in jus's table):
- **new** `cube-dev/cube/model/cubes/jus/user_roles.yml` — `sql_table: mf_ingame_roles`.
- **edit** `cube-dev/cube/model/views/jus/user_360.yml` — appended the `user_roles_panel` view block.

Restart `cube_api` + `cube-refresh-worker` (DEV_MODE=false, no hot-reload). Then refresh stored profiles — existing 9,500 jus snapshots kept `name = NULL` until re-fetched; targeted `upsertVipProfiles` took them 0 → 9,500 named. Sample: `Chu Dịch`, `ThấtDạ`, `Mạc Trúc Y`, `Khứa Này Hài`.

## Two-part gotcha
The fetcher reads the **view** (`user_roles_panel`), not the cube. Adding `user_roles` alone wouldn't have worked — the `user_360.yml` view block was the other half. Both pieces required.

## Lesson generalized
A per-game surface has two kinds of data dependency: (1) gated members the availability/coverage check sees, and (2) identity/enrichment views the fetch code reads by name, unconditionally. (2) fails silently. When onboarding a game, port the canonical game's **full view set + backing cubes**, not just the playbook marts.

Organized into a reusable onboarding guide: `docs/game-onboarding-data-yaml.md` (CS dashboard = first use case, Tier 0 = identity/profile, Tier 1 = playbook marts). Bug-shape added to `docs/lessons-learned.md` → Cube model.

## Unresolved
- Other games (muaw, pubg, ballistar) may have the same missing `user_roles_panel` view — not audited this round; the onboarding guide's checklist covers them when next touched.
