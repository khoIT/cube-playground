# Phase 4 · Dedupe, triage, fix worklist

**Priority:** P0 (gate before any fix)
**Status:** pending
**Depends on:** Phases 1, 2, 3 verified ledgers

## Overview
Consolidate the three verified ledgers into one deduped, prioritized fix worklist. Many findings share a single root cause across games (e.g. one missing measure absent in 5 games = ONE fix in the generator, not 5). Dedupe by root cause, then sequence.

## Key insights
- Root-cause dedupe is what makes this tractable: a canonical-cube defect repeats across all 8 games but is one generator edit. A bespoke-cube defect is per-game.
- Triage must honor the user-decision guardrail: parity gaps where the user/owner picked scope (revenue_vnd_real cfm-only, trailing measures deprioritized) are NOT auto-fixed — surface to user (seed open questions 1–3).

## Requirements
- Merge `verified-findings-oracle-games.md` + `verified-findings-oracle-less-games.md` + `metric-layer-findings.md`.
- Dedupe: group findings by `(root_cause_key)` where key = cube+dimension+fix-shape, collapsing per-game repeats; record affected-games list per group.
- Classify each group:
  - **FIX-correctness** — real bug, dev wrong vs oracle/rule. Always fix.
  - **FIX-parity** — source exists, measure missing; fix UNLESS it reverses a user scope decision → then ASK.
  - **N/A** — source-blocked; mark applicability N/A in metric YAML, no cube change.
  - **WONTFIX/intentional** — documented divergence.
- Sequence FIX groups: canonical-generator fixes first (broad blast radius), then per-game bespoke, then metric-YAML/applicability edits.
- Flag each fix as `via_generator` (canonical cube) or `hand_edit` (bespoke/etl/role cube).

## Architecture / approach
- Output `reports/fix-worklist.md`: one row per root-cause group → {id, severity, affected games, fix mechanism, files, ASK-user? y/n}.
- A short "decisions needed" section lists every group blocked on a user call (don't proceed to Phase 5 on those until answered).

## Related code files
- Read: the three verified ledgers + `reports/parity-findings.jsonl`
- Create: `reports/fix-worklist.md`

## Implementation steps
1. Load all findings; compute root-cause key; group.
2. Classify + assign fix mechanism (generator vs hand-edit).
3. Sequence by blast radius + severity.
4. Extract user-decision gate list; pause for answers before Phase 5 fixes that touch confirmed scope.

## Todo
- [ ] merge + dedupe by root cause
- [ ] classify (FIX-correctness / FIX-parity / N/A / WONTFIX)
- [ ] assign via_generator vs hand_edit
- [ ] sequence + write worklist
- [ ] surface decisions-needed list to user

## Success criteria
- Single worklist; no duplicate fixes across games for the same root cause.
- Every correctness bug scheduled; every parity gap classified fix/ask/N-A.
- User-scope-touching changes are gated, not silently applied.

## Risks
- Over-aggressive dedupe could merge two superficially-similar but distinct bugs. Keep the per-game finding IDs under each group so a fix can be split if needed.

## Next
Approved worklist → Phase 5 execution.
