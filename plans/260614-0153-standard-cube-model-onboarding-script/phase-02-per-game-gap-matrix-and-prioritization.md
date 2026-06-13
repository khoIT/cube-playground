# Phase 02 — Per-game gap matrix + prioritization

## Context links
- Coverage inventory: re-grepped from `cube-dev/cube/model/cubes/<game>/` (8 games)
- Metric reverse index: `server/src/presets/business-metrics/*.yml` (69 metrics)
- Phase 01 canonical catalog

## Overview
- Priority: P1 (analysis). Status: pending. Depends on 01.
- Exact list of which canonical cubes each game lacks vs the standard, ranked by metric-unlock value.

## Key insights — coverage matrix (✓ present / — absent), re-verified by grep
| Canonical cube | ballistar | cfm | cros | tf | ptg | jus | muaw | pubg |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| mf_users | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| active_daily | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| user_recharge_daily | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| recharge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| game_key_metrics | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| retention | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| new_user_retention | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| marketing_cost | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| user_roles | — | ✓ | ✓ | ✓ | — | ✓ | — | — |
| user_active_monthly | — | ✓ | ✓ | ✓ | — | — | — | — |
| user_recharge_monthly | — | ✓ | ✓ | ✓ | — | — | — | — |
| user_devices | — | ✓ | ✓ | ✓ | — | — | — | — |
| user_ips | — | ✓ | ✓ | ✓ | — | — | — | — |
| user_active_rolling | — | ✓ | — | — | — | ✓ | — | — |
| user_recharge_rolling | — | ✓ | — | — | — | ✓ | — | — |
| user_gameplay_daily | — | ✓ | — | — | — | ✓ | — | — |
| ordered_event_funnel | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ |
| ordered_funnel_canonical | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ |

NOTE: This re-grepped matrix DIFFERS from finding-5's cube-count grouping. Empirically cros/tf LACK
game_key_metrics/retention/new_user_retention/marketing_cost but HAVE the per-user monthly+devices+ips+roles
set; ballistar/muaw/pubg are the inverse. Trust this matrix (re-verified) over the count-based grouping.

## Metric-unlock value (reverse index — how many of 69 metrics a cube gates)
1. `game_key_metrics` → 24 metrics (installs, nru, roas, ltv, cpi, npu, …)
2. `mf_users` → 11
3. `active_daily` → 9
4. `user_recharge_daily` → 6
5. `retention` → 4 (rr, rr01, rr07, rr30)
6. `recharge` → 3
7. `new_user_retention` → 1
- Bespoke (L3, not part of this rollout): `funnel`→4, `etl_money_flow`→3, `etl_lottery_shoot`→3, `etl_newbie_tutorial`→3.

## Prioritized gap list (high-value first)
1. **cros + tf: add `game_key_metrics`** → unlocks 24 metrics each (biggest single win). Also add
   `retention`+`new_user_retention`+`marketing_cost` (5 more metrics + ROAS/cost story).
2. **ballistar + muaw + pubg: add `user_roles`** → enables member-name parity + role panels. KEEP fan-out
   guard (phase 06). Also add `user_active_monthly`/`user_recharge_monthly` (monthly mart parity).
3. **ballistar/muaw/pubg + cros/tf: add `user_devices`/`user_ips`** (Tier-3, 360/fraud panels) where absent.
4. **ptg: special case** — no mf_users/active_daily at all + 75.5M rows. Defer to phase 06 isolated track.
5. Rolling marts (`user_active_rolling`/`user_recharge_rolling`/`user_gameplay_daily`) — Tier-3, fill last.

## Requirements
- Output: a per-game "gap card" listing missing canonical cubes + the metric ids each gap blocks today,
  so phase 05 can assert "metric X becomes available for game Y once cube Z lands".
- Confirm the `funnel` logical-name question (open decision 5): does `required_cubes: [funnel]` resolve to
  `ordered_event_funnel`/`ordered_funnel_canonical`, or a missing view? Grep availability resolver
  (`server/src/presets/registry.ts` + the metric availability check) to confirm name mapping before phase 05.

## Related code files
Read only. No edits. Produces `reports/per-game-cube-gap-matrix.md`.

## Implementation steps
1. Freeze the re-grepped matrix above (already verified) into the gap report.
2. For each absent cell, attach the blocked metric ids from the reverse index.
3. Rank gaps by (metric-unlock count × games-affected). Produce the rollout order for phase 06.
4. Resolve the `funnel` name mapping; document as input to phase 05.
5. Tag ptg as isolated track.

## Todo
- [ ] Gap report with per-game gap cards + blocked metric ids
- [ ] Rollout-order ranking for phase 06
- [ ] `funnel` name-mapping resolution
- [ ] ptg flagged isolated

## Success criteria
- Each of 8 games has an explicit missing-cube list mapped to blocked metric ids.
- Rollout order is value-ranked and feeds phase 06 sequencing.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Matrix drifts as parallel sessions edit cube dirs (memory: concurrent sessions) | Med×Med | Re-grep at phase-06 start per game, not once; treat matrix as snapshot. |
| `funnel` maps to nothing → 4 metrics never available | Med×Low | Step 4 resolves before phase 05; out-of-scope if it's an L3 view. |

## Security considerations
- None new (analysis only). PII cubes (devices/ips) flagged for phase 06 public=false carry-over.

## Next steps
- Feeds phase 05 (availability reconcile) and phase 06 (rollout order).
