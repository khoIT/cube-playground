# Phase 6 · Verification + regression gate

**Priority:** P1
**Status:** pending
**Depends on:** Phase 5 fixes

## Overview
Prove the fixes hold, and make the audit permanent so these bug classes can't silently return. Turn the one-time harness into a standing CI gate.

## Key insights
- An audit that isn't wired into CI decays — the same bugs creep back on the next game onboarding. The harness from Phase 0 becomes the regression gate.
- Final verification is end-to-end: cube compiles, rollups route, metric coverage up, chat seed resolves.

## Requirements
- Re-run full `audit:cube-parity` across all 8 games → zero open FIX-correctness findings; remaining items are documented intentional/N-A.
- Re-run `audit:metric-trust` + `check:metric-drift` + glossary integrity → certified % at or above baseline (72.8%), no new dangling refs.
- Spot-check 2–3 fixed cubes live: query through Cube, confirm compiled SQL + rollup routing (restart-aware) + numbers sane vs a known-good reference.
- Wire `audit:cube-parity` into the same CI lane as `check:metric-drift` (read-only gate; fails on new correctness-severity findings).
- Docs: add a `docs/lessons-learned.md` entry per NEW bug shape found; update `docs/metric-trust-audit-playbook.md` snapshot; note the new parity gate in `docs/codebase-summary.md` / `docs/system-architecture.md` as appropriate.

## Architecture / approach
- CI gate compares current findings against a committed `parity-baseline.json` of accepted intentional/N-A items; any new `correctness` finding fails the build.

## Related code files
- Add CI step invoking `cube-dev` `audit:cube-parity --gate`
- Create: `cube-dev/scripts/parity-baseline.json` (accepted exceptions)
- Edit: `docs/lessons-learned.md`, `docs/metric-trust-audit-playbook.md`

## Implementation steps
1. Full re-audit (cube + metric layers); confirm green.
2. Live spot-check of representative fixes (compiled SQL + rollup routing).
3. Add the gate + baseline to CI.
4. Update docs + lessons-learned; refresh memory pointers if a durable fact changed.

## Todo
- [ ] full re-audit green (cube + metric)
- [ ] live spot-check of representative fixes
- [ ] CI gate + baseline committed
- [ ] docs + lessons-learned updated

## Success criteria
- Zero open correctness findings; intentional/N-A captured in baseline.
- Metric certified % ≥ baseline; no new dangling refs.
- CI fails on a newly-introduced correctness finding (verified with a deliberate test break).
- Future game onboarding inherits the gate automatically.

## Risks
- Live spot-check needs a running stack with data; if Local lacks billing data for a game, verify via compiled SQL shape only and note the data-absence (not a bug).

## Next
Audit complete. Standing gate prevents regression; next game onboarding runs clean through it.
