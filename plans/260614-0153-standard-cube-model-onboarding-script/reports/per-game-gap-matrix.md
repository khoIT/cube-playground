# Per-game gap matrix — Phase 02

> Of the 14 portable canonical cubes (frozen catalog, Tier A+B minus the 2 etl-sourced bespoke cubes).
> `recharge` + `ordered_funnel_canonical` excluded — etl_ingame_* tables vary per game (not portable).
> Verified 2026-06-14 by `onboard-game-cube-model.mjs --dry-run`. cfm = reference (complete).

## Missing canonical cubes per game (of 14)

| Game | Schema | Has | Missing | Anomaly | Missing cubes |
|------|--------|-----|---------|---------|---------------|
| cfm | cfm_vn | 14 | 0 | — | (reference) |
| jus | jus_vn | 10 | 4 | **dual-identity** (46.8% `@`) | user_active_monthly, user_recharge_monthly, user_devices, user_ips (mf_users hand-tuned, flagged not emitted) |
| cros | cros | 8 | 6 | — | game_key_metrics, new_user_retention, retention, marketing_cost, user_active_rolling, user_recharge_rolling |
| tf | tf | 8 | 6 | **role-name-absent** (100% NULL) | same 6 as cros (mf_users flagged: drop ingame_name) |
| ballistar | ballistar_vn | 7 | 7 | — | user_active_monthly, user_recharge_monthly, user_roles, user_devices, user_ips, user_active_rolling, user_recharge_rolling |
| muaw | muaw | 7 | 7 | — | same 7 as ballistar |
| pubg | pubgm | 7 | 7 | — | same 7 as ballistar |
| ptg | ptg | 0 | 14 | **high-scale** (302M rows) | full set incl. mf_users/active_daily — pre-aggs from cfm template + serving restart required |

## Value ranking (which gaps unlock the most)
- `game_key_metrics` → gates ~24 server-preset metrics → top priority for cros, tf.
- `mf_users` (hub) + `active_daily` → gates segments + DAU surfaces → ptg priority.
- monthly/rolling/devices/ips → enrichment (cohort, care, PII) → ballistar/muaw/pubg/jus.

## Rollout order (value-ranked, fan-out-guarded — Phase 06)
1. **cros** (clean, +4 marts + 2 rolling)
2. **tf** (confirm role-name-absent → mf_users keep omitted; +6 cubes)
3. **ballistar** (FAN-OUT GUARD: user_roles many_to_one; +7)
4. **muaw** (same as ballistar)
5. **pubg** (same; note pubg lacked etl_ingame_register → affects only bespoke funnel/session, not these 14)
6. **jus** (gap-fill 4; `--only` excludes mf_users — preserve hand-tuned merge CTE)
7. **ptg** (LAST, isolated — full 14 incl. mf_users WITH pre-aggs; restart cube_api+worker; probe usedPreAggregations)

## Notes
- Existing per-game cubes have DRIFTED to thinner shapes (older/fewer measures + rollups than cfm). The
  generator's non-destructive default only fills MISSING cubes; standardizing the thin existing ones (e.g.
  ballistar's simpler active_daily) requires `--force` and is a separate, higher-risk decision (Phase 06).
- 0 column-name drift for all portable source tables across every game tested → templates compile-safe.

## Unresolved questions
- Do we `--force`-standardize the already-present-but-thinner cubes (richer cfm measures/rollups), or only
  fill missing? Default this round: fill missing only. `--force` standardization deferred to Phase 06 review.
