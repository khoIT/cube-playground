# Layer-2 preset / metric reconciliation — Phase 05

> Verification pass over the server presets (69 business-metrics + 3 bundles). Outcome: **zero L2 code edits
> required** — availability is data-driven and the wiring is already correct. One plan assumption corrected
> (the `funnel` reference is NOT a typo). Verified 2026-06-14.

## 1. Availability is data-driven (CONFIRMED — no hardcoded per-game gate)
- Resolver pattern: `required_cubes ⊆ availableCubes`, where `availableCubes` is a Set built from the game's
  live Cube `/meta`. Evidence: `server/src/services/dashboard-starter-pack-seeder.ts:29-34`
  (`isApplicable`: `for (const cube of required_cubes) if (!availableCubes.has(cube)) return false`).
- `availableCubes` derived from `/meta` per game (`dashboard-starter-pack-seeder.ts:20-21`,
  `server/src/care/availability.ts` for the care-side equivalent).
- Fallback when `/meta` unreachable: trust the declared `game_compatibility.required_cubes`
  (`anomaly-state-store.ts:68-73`) — still data-driven, no allow-list.
- **Consequence:** filling an L1 gap in Phase 06 AUTOMATICALLY flips the dependent metrics available for
  that game. No L2 edit, no per-game special case. Success criterion met.

## 2. `funnel` reference — RESOLVED: not a typo, do NOT rename
The 4 `cvr_*` metrics (`cvr_install`, `cvr_cdn_download`, `cvr_login_form`, `cvr_register`) declare
`required_cubes: [funnel]` and reference measures `funnel.users_completed_{install,cdn_download,login_form,register}`
and `funnel.users_total`.

- These are **AppsFlyer acquisition-funnel** measures (Install → CDN Download → Show Login Form → Register).
- The in-game cubes are `ordered_event_funnel` / `ordered_funnel_canonical`, whose ONLY measure is
  `step_count` (dims `step_index`/`step_name`). They do **not** expose `users_completed_*`/`users_total`.
- Therefore `funnel` is a **distinct, not-yet-ingested AppsFlyer cube**, NOT a misspelling of the in-game
  funnel. All 4 metrics are `trust: draft` and their applicability note already states "AppsFlyer funnel
  data is not ingested for this game."
- **Decision: leave the 4 metrics unchanged.** Renaming to `ordered_event_funnel` would point them at
  measures that do not exist (breaks them, or falsely marks them available). They are correctly unavailable
  on every game until an AppsFlyer `funnel` cube is modeled (out of scope this round). This corrects the
  plan's "likely typo" framing (open decision 5).

## 3. Fan-out guard audit (CONFIRMED intact)
All bundle `reachableCubes` (`server/src/presets/bundles/`):
- `mf-users-hub.yml:25` → `[mf_users]`
- `recharge-events.yml:20` → `[recharge]`
- `etl-game-detail.yml:23` → `[etl_game_detail, mf_users]`

**No bundle contains `user_roles`.** Adding `user_roles` to a game in Phase 06 (ballistar/muaw/pubg) must
NOT add it to any bundle's `reachableCubes` — the guard holds and is a Phase-06 checklist item.

## 4. Per-game metric availability delta (after Phase-06 gap fill)
Reverse index — metrics gated by each canonical cube: `game_key_metrics`=24, `mf_users`=10,
`active_daily`=9 (7 primary + 2 secondary), `user_recharge_daily`=6, `retention`=4, `recharge`=3,
`new_user_retention`=1. (`funnel`=4 stay dead — see §2. `user_roles`/monthly/rolling/devices/ips gate 0
business-metrics — their value is segments/panels/care, not the metric catalog.)

| Game | L1 gaps to fill (Phase 06) | Business-metrics that flip available | Non-metric value gained |
|------|----------------------------|--------------------------------------|-------------------------|
| **cros** | game_key_metrics, new_user_retention, retention, marketing_cost, rolling×2 | **+~29** (game_key_metrics 24 + retention 4 + new_user_retention 1) | care rolling signals |
| **tf** | same as cros (mf_users keeps ingame_name omitted) | **+~29** | care rolling signals |
| **ballistar** | user_roles, monthly×2, devices, ips, rolling×2 | ~0 (metrics already present) | role panels, cohort, PII spokes, care |
| **muaw** | same as ballistar | ~0 | same |
| **pubg** | same as ballistar | ~0 | same |
| **jus** | monthly×2, devices, ips (mf_users hand-tuned) | ~0 | cohort, PII spokes |
| **ptg** | full 14 incl. mf_users/active_daily | **+~52** (game_key_metrics 24 + mf_users 10 + active_daily 9 + user_recharge_daily 6 + retention 4 + new_user_retention 1) | segments, care, dashboards — full stack |

## 5. FE mirror
FE imports the same metric/bundle YAML via Vite `?raw` (`preset-bundles-loader.ts:1-10`) — no separate TS
mirror to edit. Bundle/metric changes propagate automatically. No FE edit needed (and none made).

## Conclusion
Phase 05 requires **no code or YAML edits**. The L2 layer is already correctly data-driven; the only finding
(`funnel`) is intentional, not a bug. Phase 06 gap-fills will flip availability with no L2 work. The biggest
swings: cros/tf (+~29 each via `game_key_metrics`), ptg (+~52 via the full hub stack).

## Unresolved questions
- None for L2. (An AppsFlyer `funnel` cube to activate the 4 `cvr_*` metrics is a separate, out-of-scope item.)
