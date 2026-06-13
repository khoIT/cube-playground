# Phase 07 — Tests / validation harness

## Context links
- Generator: phase 03/04 script
- Probe patterns: memory "CubeStore introspection + probe hardening" (asserts usedPreAggregations),
  `cube-dev/scripts/measure-preagg-build.sh`
- Cube /meta + /load: per-tenant via `x-cube-workspace: local` (memory "Cube default workspace is local")
- Availability: phase 05

## Overview
- Priority: P2. Status: pending. Depends on 03, 06.
- Validate: (1) generator correctness (round-trip + clean emit), (2) emitted YAML compiles + loads per game,
  (3) fan-out guard holds, (4) availability flips as predicted. No mocks of Trino/Cube — use the real local stack.

## Key insights
- The strongest correctness test is a **cfm round-trip**: generate cfm's canonical cubes from templates,
  diff against the existing hand-authored cfm files — only title/whitespace should differ. Proves the template
  IS the current production shape (generator-as-truth fidelity).
- Compile/load must hit the real per-tenant Cube (`x-cube-workspace: local`), not a mock — mocks hide the
  schema-resolution + pre-agg routing that is the whole point (development-rules: no mocks to pass build).

## Requirements
Functional:
1. **Generator unit tests**: introspect signature-compare logic; anomaly detector thresholds (synthetic
   signal inputs → expected classification); template render (title substitution, no stray placeholders).
2. **cfm round-trip test**: emit → diff vs `cube-dev/cube/model/cubes/cfm/` canonical cubes → assert
   semantic-equal (parse YAML, compare structure, ignore title/whitespace).
3. **Compile test per rolled-out game**: POST a trivial query / GET `/meta` for each cube → 200, cube present.
4. **Load smoke test**: one representative query per new cube returns rows (or empty, not error).
5. **Fan-out guard test**: on a game that gained user_roles, assert `mf_users.user_count` with a user_roles
   join present == without it (no inflation). Assert no bundle reachableCubes contains user_roles
   (static scan of `server/src/presets/bundles/*.yml` + FE mirror).
6. **Availability test**: for each game, assert metrics predicted-available (phase 05 delta) resolve available
   via the real availability check.
7. **Pre-agg probe (ptg, if onboarded)**: query routes to rollup (`usedPreAggregations` non-empty) post-restart.

Non-functional:
- Tests runnable locally against the dev stack; CI-gateable for at least the unit + round-trip + static-scan
  tiers (those need no live Trino).

## Architecture / data flow
```
unit (no stack) ──▶ round-trip diff (no stack) ──▶ static guard scan (no stack)
        │                                                  │
   [CI-gateable tier] ───────────────────────────────────┘
        │
live tier (dev stack): /meta compile ──▶ /load smoke ──▶ fan-out count ──▶ availability ──▶ preagg probe
```

## Related code files
Create:
- `scripts/__tests__/onboard-game-cube-model.test.mjs` (unit + round-trip + static scan) — main repo, beside script.
- A live-validation script (extend `cube-dev/scripts/measure-preagg-build.sh` ethos) for the stack-dependent tier.
Read: phase 03/04 script, cfm cube files, bundles, phase 05 delta report.

## Implementation steps
1. Unit tests for signature-compare + 4 detectors + render.
2. cfm round-trip: render all canonical templates for cfm, YAML-parse-diff vs disk.
3. Static guard scan: grep bundles + FE mirror; fail if `user_roles` in any reachableCubes.
4. Live compile + load smoke per rolled-out game (loop over games via JWT/workspace header).
5. Fan-out count-equality assertion on a user_roles game.
6. Availability assertions from phase-05 delta.
7. ptg pre-agg probe (only if onboarded).

## Todo
- [ ] Unit: signature-compare, detectors, render
- [ ] cfm round-trip diff (semantic-equal)
- [ ] Static fan-out guard scan (bundles + FE)
- [ ] Live compile + load smoke per game
- [ ] Fan-out count-equality test
- [ ] Availability assertions
- [ ] ptg preagg probe (conditional)

## Success criteria
- Unit + round-trip + static scan pass in CI without a live stack.
- Every rolled-out game compiles + serves its new cubes against the real local Cube.
- Fan-out guard test green (count unchanged; no reachableCubes regression).
- Predicted metric availability confirmed per game.
- All tests use the real stack for the live tier — no Trino/Cube mocks.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Round-trip diff noisy on whitespace/key-order | Med×Low | Compare parsed YAML structures, not text. |
| Live tier flaky on cold Trino (3.5–15s, memory) | Med×Med | Generous timeouts; retry; keep live tier out of the CI-gate (manual/nightly). |
| Pre-agg probe green-but-dormant (rollup exists, no partitions) | Med×Med | Assert usedPreAggregations on an actual query, not just rollup presence (memory: CubeStore dormant locally). |
| Mocked test masks schema-resolution bug | Low×High | Policy: live tier hits real Cube; no mocks (dev rules). |

## Security considerations
- Test queries must not dump PII; use count/aggregate measures. Use the local workspace, never prod, for
  load tests.

## Next steps
- Green harness gates each phase-06 game PR. Update `docs/` (canonical-cube-model + lessons-learned) post-rollout.
