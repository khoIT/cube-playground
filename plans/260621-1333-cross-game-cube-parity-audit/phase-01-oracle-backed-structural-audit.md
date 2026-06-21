# Phase 1 · Oracle-backed structural audit (cfm, jus, ballistar, cros, tf)

**Priority:** P0
**Status:** pending
**Depends on:** Phase 0 harness

## Overview
For the 5 dev games that have a prod oracle, run the harness and then **human/agent-verify every flagged finding by re-reading both the dev YAML and the prod oracle YAML** (the seed proved summaries lie — jus recharge PK was mis-summarized). Output a verified finding ledger per game.

## Key insights
- Prod is authoritative for PK, join keys, and measure definitions on the shared cubes. A dev/oracle divergence is a candidate bug — but not automatically a bug: dev sometimes intentionally diverges (jus identity CTE, per-game etl schema). Each divergence is triaged, not auto-flipped.
- This is where the "verify against cube-prod" step of the methodology lives.

## Requirements
- Run `audit:cube-parity` scoped to {cfm, jus, ballistar, cros, tf}.
- For each `correctness`/`parity` finding: open dev `file:line` AND prod counterpart, confirm the diff is real and classify:
  - **Real bug** → dev wrong vs oracle (PK fan-out, missing additive guard, wrong time-dim, broken identity join).
  - **Intentional divergence** → dev correct-by-design (document why; suppress from worklist).
  - **Oracle-ahead** → prod has a measure/fix dev lacks → parity gap to backfill.
- Pay explicit attention to the seed suspects: TF mf_users ingame_name join, TF rollup coverage, jus role_* rollups, cros lapsed_/trailing_ measures, revenue_vnd_real parity.

## Architecture / approach
- Fan out one verification pass per game (5 passes); each consumes that game's slice of `parity-findings.jsonl`.
- Annotate each finding with `verdict: real_bug|intentional|oracle_ahead` + a one-line rationale citing both files. Write to `reports/verified-findings-oracle-games.md`.

## Related code files
- Read: all `cube-dev/cube/model/cubes/{cfm,jus,ballistar,cros,tf}/*.yml`
- Read (oracle): all `/cube-prod/cube/model/cubes/{cfm_vn,jus_vn,ballistar_vn,cros,tf}/*.yml`
- Create: `reports/verified-findings-oracle-games.md`

## Implementation steps
1. Run harness for the 5 games; collect findings.
2. Per game, walk findings; re-read dev+oracle; assign verdict + rationale.
3. Explicitly resolve each seed suspect (confirm or clear).
4. Produce the verified ledger grouped by game then severity.

## Todo
- [ ] cfm pass · [ ] jus pass · [ ] ballistar pass · [ ] cros pass · [ ] tf pass
- [ ] resolve all seed suspects with file-cited verdicts
- [ ] verified ledger written

## Success criteria
- Every Phase-0 finding for these games carries a verdict + dual-file citation.
- No finding accepted on a summary alone.
- Intentional divergences documented so they don't re-flag next run.

## Risks
- Oracle itself may lag dev in places (dev has newer cubes prod never got). "No oracle counterpart" ≠ bug — route those cubes to Phase 2's canonical-rule checks instead.

## Next
Verified ledger → Phase 4 dedupe/triage.
