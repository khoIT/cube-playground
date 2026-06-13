# Phase 05 — Layer-2 preset / metric reconciliation

## Context links
- Metrics: `server/src/presets/business-metrics/*.yml` (69; `formula.ref` + `game_compatibility.required_cubes`)
- Bundles: `server/src/presets/bundles/{mf-users-hub,recharge-events,etl-game-detail}.yml`
- Registry + loader: `server/src/presets/registry.ts`, `preset-bundles-loader.ts`
- FE mirror: `src/pages/Segments/presets/` (Vite `?raw` import — same YAML files)
- Dashboard packs: `server/src/presets/dashboard-starter-pack/*.yml`

## Overview
- Priority: P2. Status: pending. Depends on 01, 02.
- After L1 cubes are standardized, reconcile L2 so metric/dashboard/segment/playbook availability becomes
  consistent across games. Availability gates on `required_cubes` — once a game gains a canonical cube, its
  metrics must flip available. This phase confirms the wiring is automatic (data-driven) and fixes any
  hardcoded per-game assumptions.

## Key insights
- Availability is data-driven: a metric is available for game G iff all its `required_cubes` exist in G's
  compiled model. So filling L1 gaps (phase 06) AUTOMATICALLY unlocks metrics — IF `required_cubes` names
  match the canonical cube names exactly. This phase's main job is verification, not rewiring.
- `funnel` name mismatch (open decision 5): 4 cvr_* metrics list `required_cubes: [funnel]` but the cubes are
  `ordered_event_funnel`/`ordered_funnel_canonical`. Either (a) a view named `funnel` exists, or (b) these
  metrics are unavailable everywhere. MUST resolve (grep the availability resolver + views dirs) before
  declaring metric counts.
- Bundles keep `reachableCubes: [mf_users]` (`mf-users-hub.yml:25`) — the fan-out guard. Adding user_roles to a
  game must NOT add user_roles to any bundle's reachableCubes. This phase asserts that invariant.

## Metrics newly unlocked per game once L1 gaps filled (from phase-02 reverse index)
- **cros + tf** gain `game_key_metrics` → +24 metrics each; + `retention`(+4), `new_user_retention`(+1),
  `marketing_cost` story. (Biggest L2 swing.)
- **ballistar/muaw/pubg** gain `user_roles` → role panels; mf_users-derived metrics already present.
- ptg: only `recharge` today → gains the full mf_users/active_daily stack IF onboarded (phase 06 special case).

## Requirements
Functional:
1. Verify the availability resolver reads `required_cubes` against the live compiled model per game (no
   per-game hardcoded allow-lists). Grep `registry.ts` + the business-metrics loader + any
   `game_compatibility` consumer.
2. Resolve the `funnel` name mapping; either fix the 4 metrics' `required_cubes` to the real cube names or
   document them as L3-dependent.
3. Confirm bundles + dashboard-starter-pack don't hardcode game lists that would mask newly-available cubes.
4. Assert no bundle gains user_roles in reachableCubes (fan-out guard regression test).
5. FE mirror parity: since FE imports the same YAML via `?raw`, no separate FE edit needed for metrics — but
   confirm bundle changes propagate (loader comment: `preset-bundles-loader.ts:1-10`).

Non-functional:
- DRY: prefer fixing names/data over adding per-game special-cases. No new availability code unless the
  resolver is found to be hardcoded.

## Architecture / data flow
```
L1 model (per game) ──▶ /meta compiled cubes ──▶ availability check(required_cubes ⊆ compiled cubes)
                                                        │
                          metric available? ──▶ Segments insights / dashboards / playbooks
```

## Related code files
Read: `registry.ts`, `preset-bundles-loader.ts`, all `business-metrics/*.yml` (names), `bundles/*.yml`,
`dashboard-starter-pack/*.yml`, FE `src/pages/Segments/presets/registry.ts`.
Edit (main repo, only if needed): the 4 cvr_* metric files (`funnel`→real name) ; any hardcoded game list.

## Implementation steps
1. Trace the availability check end-to-end; confirm it's `required_cubes ⊆ compiled(game)`.
2. Resolve `funnel`: grep views dirs + resolver. Fix or document.
3. Audit bundles/dashboards for hardcoded game gates; remove/justify.
4. Add a regression assertion: no bundle reachableCubes contains user_roles.
5. Produce `reports/metric-availability-delta.md`: per game, metrics that flip available after phase-06.

## Todo
- [ ] Availability resolver trace (confirm data-driven)
- [ ] `funnel` mapping resolved/fixed
- [ ] Bundle/dashboard hardcoded-game audit
- [ ] Fan-out guard assertion (no user_roles in reachableCubes)
- [ ] Availability-delta report per game

## Success criteria
- Filling an L1 gap flips the dependent metrics available for that game with NO L2 code change (proves
  data-driven), OR the exact required edit is enumerated.
- `funnel`-referencing metrics resolve to real cubes or are documented L3.
- No bundle reachableCubes includes user_roles (guard intact).
- Per-game availability delta documented.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Availability is hardcoded somewhere → silent stale gating | Med×High | Step 1 traces it; remove hardcode or document the one edit point. |
| FE/server YAML drift | Low×Med | Same files via `?raw` (loader doc); no TS mirror to drift. |
| Adding user_roles to a game accidentally widens a bundle | Low×High | Step 4 assertion + phase-06 checklist. |
| `funnel` fix changes numbers on games that already "had" it | Low×Med | Confirm current behavior first; only rename if genuinely broken. |

## Security considerations
- Newly available metrics on PII-spoke cubes (devices/ips) must keep dims `public:false`; metrics reference
  measures (counts), not raw PII dims. Verify no metric exposes a PII dimension.

## Next steps
- Runs after each phase-06 game lands (or once at the end) to confirm availability flipped as predicted.
