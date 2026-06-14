# Member 360 — roll out to all eligible games (local)

## Goal
Enable the per-member 360 for every local game whose Cube model can support it, after the
jus_vn enablement. Surface the rest honestly via the existing coverage matrix.

## The three gated layers (per game)
Trino tables → base cubes + `views/<game>/user_360.yml` → product config
(`PANELS_BY_GAME` + `SECTIONS_BY_GAME` FE, mirrored server `CORE_PANELS_BY_GAME`).

## Scope decision (user-confirmed)
**Core-4 + full-fidelity cros/tf.** cros/tf get their full rich view family; muaw/pubg get
the core-4; ptg stays blocked (no base cubes). Raw `transactions` for tf deferred (role_id-keyed,
redundant with VND `recharge_timeline`).

## What landed per game
| Game | Delivered | Status |
|---|---|---|
| cros | Full 12 panels, all `user_id`-keyed (device/IP = aggregate count rollups, not per-row PII) | ready |
| tf | Full set; login/logout/register `role_id`-keyed via the role bridge; raw txns deferred | ready (8 core probe green) |
| muaw / pubg | New `user_360.yml` core-4 (per-game recharge fields) → reuse ballistar panel set | ready |
| ballistar / cfm / jus | already enabled | unchanged |
| ptg | only `recharge` cube — no mf_users/activity | blocked (na) |

## Key decisions / findings
- **cros ≠ tf**: cros multi-region (`payment_platform`, `hour_of_day_vn`, user_id events);
  tf strategy game (`hour_of_day_local`, alliance/lineup fields, role_id-keyed TGA events) →
  **separate panel sets**, not shared.
- **device/IP views are aggregate rollups** for cros/tf (distinct counts, no `device_id`/`client_ip`)
  → measures-only panels, NOT a blind copy of cfm's per-row PII list.
- **Role bridge generalized**: `IdentityKey` gained `role_id`; `event-panel-grid` bridges both
  `playerid` (cfm) and `role_id` (tf) through `user_roles_panel`.
- **Coverage probe made kind-aware**: `probeMember` → `{member, kind}`; a measures-only panel
  must probe as a measure, not a dimension (was 400'ing).
- **tf added to `gds.config.json`** (was absent from the game registry) → appears in matrix +
  selector after a dev-server restart (config loads at boot).

## Verification
- `/meta` (minted per-game JWT): all new views compile. cros/tf full 12; muaw/pubg core-4.
- Live coverage on `local`: cros/muaw/pubg **ready**; tf 8 core panels probe rows>0 directly.
- Tests: server **959/959**; FE member360 43/43; server build clean; no typecheck errors in
  touched files. (7 pre-existing FE failures in Catalog/concept-map + DevAudit — proven on clean HEAD.)
- 2 lessons-learned entries added (measure-as-dimension probe; per-game view-grain divergence).

## Prod parity (tracked, not in this change)
Prod = prefixed/upstream kraken model. Needs: (1) upstream model exposing `user_360` views in
prefixed naming per game, (2) prefix-aware coverage probe (currently `prefixUnsupported`),
(3) product config already workspace-agnostic. Blocked upstream, not in this repo's product layer.

## Status
- [x] cros full-fidelity panels (FE + server core mirror)
- [x] tf full-fidelity panels + role_id bridge
- [x] muaw / pubg core-4 views + wiring
- [x] tf in gds.config game registry
- [x] coverage probe kind-aware fix
- [x] tests + parity guard updated; docs/lessons-learned
