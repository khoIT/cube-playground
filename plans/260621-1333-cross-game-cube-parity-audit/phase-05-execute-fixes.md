# Phase 5 · Execute fixes (generator-aware)

**Priority:** P0
**Status:** pending
**Depends on:** Phase 4 approved worklist (+ user answers on gated items)

## Overview
Apply the worklist fixes. The single most important rule: **canonical-cube fixes go through the generator + regenerate; bespoke cubes are hand-edited in place.** Hand-editing a canonical cube gets silently overwritten on the next generator run — a trap this plan exists to avoid.

## Key insights
- `via_generator` fix = edit `cube-dev/scripts/lib/canonical-cube-config.mjs` (or the cfm template the generator reads), then re-run `onboard-game-cube-model.mjs` for affected games → the fix lands in all games at once and survives future regens.
- `hand_edit` fix = edit the specific `recharge.yml` / `etl_*.yml` / `role_*.yml` directly.
- Verify each fix **by compiled SQL**, not by `usedPreAggregations` (lessons-learned: usedPreAggregations can falsely reassure).

## Requirements
- Process worklist groups in the Phase-4 sequence (generator-wide first).
- For each fix:
  1. Apply edit (generator or hand).
  2. If canonical → regenerate affected games; confirm the diff is exactly the intended change (no collateral relabel drift).
  3. Compile/validate: load the cube, inspect compiled SQL for the changed PK/measure/join/time-dim; confirm shape matches the oracle.
  4. If a rollup changed and DEV_MODE=false → restart cube_api + worker so the new rollup routes; re-probe.
- Metric-YAML applicability (N/A) edits: set `meta.applicability` per game; re-run `audit:metric-trust` to confirm bucket moves GAP→N-A.
- Code comments on fixes describe the invariant (e.g. "transid not unique per payment → composite PK prevents SUM fan-out"), NOT plan/finding labels (per repo rule).

## Architecture / approach
- One commit per root-cause group (conventional commits, no AI refs), so each fix is revertible and the parity matrix can be re-run between commits.
- After each group: re-run `audit:cube-parity` for affected games → finding should clear.

## Related code files
- Edit (canonical): `cube-dev/scripts/lib/canonical-cube-config.mjs` + regenerate via `onboard-game-cube-model.mjs`
- Edit (bespoke): specific `cube-dev/cube/model/cubes/{game}/{recharge,etl_*,role_*}.yml`
- Edit (metric N/A): `server/src/presets/business-metrics/*.yml`

## Implementation steps
1. Generator-wide correctness fixes → regenerate → compiled-SQL verify across all affected games.
2. Per-game bespoke correctness fixes → compiled-SQL verify.
3. Parity backfills (approved) → generator or hand as classified.
4. Metric applicability N/A edits → audit:metric-trust reconfirm.
5. Re-run audit:cube-parity per group; confirm cleared.

## Todo
- [ ] generator-wide correctness fixes + regen + verify
- [ ] bespoke per-game correctness fixes + verify
- [ ] approved parity backfills
- [ ] metric N/A applicability edits
- [ ] per-group re-audit clears finding

## Success criteria
- Every FIX-correctness group resolved and verified by compiled SQL against oracle.
- No canonical cube hand-edited (all via generator).
- Re-running `audit:cube-parity` shows the fixed findings cleared, no new ones introduced.

## Risks
- Regenerating a game could clobber a legitimate hand-authored divergence. Before regen, snapshot the game's canonical cubes and diff post-regen to catch unintended overwrites. Concurrent sessions edit this repo — stage fixes by explicit path, no `git add -A`, no stash.

## Next
All fixes done → Phase 6 verification + regression gate.
