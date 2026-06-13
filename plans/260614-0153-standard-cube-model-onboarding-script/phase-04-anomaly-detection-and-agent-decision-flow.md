# Phase 04 — Anomaly detection + agent-decision flow

## Context links
- jus dual-identity override: `cube-dev/cube/model/cubes/jus/mf_users.yml:14-67`
- cfm clean baseline: `cube-dev/cube/model/cubes/cfm/mf_users.yml:7-16`
- Member-column /meta drop: `server/src/presets/bundles/mf-users-hub.yml:37-45`
- ptg pre-agg need: phase 01/02 (75.5M rows, no mf_users)

## Overview
- Priority: P1. Status: pending. Depends on 03.
- The generator SAMPLES data, DETECTS the known anomaly shapes, and FLAGS each with a proposed strategy for
  an AGENT to confirm/override before finalizing. The script does not auto-resolve anomalies — KISS: detection
  + proposal only; the agent's judgment is the resolution step the user described.

## Key insights — the 4 known anomaly shapes (from verified findings)
| Anomaly | Detection signal (sampled SQL) | Proposed strategy (agent confirms) |
|---------|--------------------------------|------------------------------------|
| **Dual-identity** (jus) | `% of mf_users.user_id LIKE '%@%' > ~5%` (jus=46.8%; clean games=0%) | Emit jus-style `split_part(user_id,'@',1)` merge CTE for mf_users instead of clean template |
| **Role-name absent** (tf) | `NULL-rate of mf_ingame_roles.ingame_last_active_role_name ≈ 100%` | Emit plain `sql_table: mf_users`, DROP `ingame_name` dim (member list uses /meta fallback) |
| **High row-scale** (ptg) | `count(*) of mf_users (or active_daily) above threshold (e.g. > 20M)` | Emit cube WITH mandatory pre-aggregation from day one; flag for pre-agg review |
| **Unpopulated sum columns** | `SUM(ingame_total_recharge_value_vnd*) = 0` on mf_ingame_roles sample | Keep role-level recharge dims as forward-compat; do NOT expose sum-measures / do NOT metric-ize |

- Thresholds are calibrated to verified data points (jus 46.8% vs 0%; tf ~100% NULL). KISS: simple percent/count
  checks on a LIMIT/`approx`-sampled query, NOT a generic profiling engine.

## Agent-in-the-loop contract
- For each detected anomaly the script emits a **decision record** in the manifest:
  `{ cube, anomaly, signal_value, proposed_strategy, alternatives, status: "needs-agent-decision" }`.
- The script does NOT write the anomalous cube's YAML until the agent supplies a decision (e.g.
  `--decisions decisions.json` mapping cube→chosen strategy, or interactive confirm).
- Clean cubes still emit immediately (phase 03) regardless of pending anomaly decisions — anomalies are isolated.
- Default proposal = the verified strategy in the table; agent can override (e.g. force clean template, skip cube).

## Requirements
Functional:
1. `sample(game)`: run the 4 detection queries (bounded `LIMIT`/aggregate), return signal values.
2. `classify()`: map signals → anomaly list with proposed strategies (table above).
3. `applyDecisions(decisions)`: render the chosen variant template for each flagged cube.
4. Manifest decision records; exit non-zero if undecided anomalies remain and not `--accept-proposals`.

Non-functional:
- Detection queries are cheap (aggregate/sampled), bounded — no full scans (respect behavior-bound ethos).
- Adding a new anomaly = add one detector + one proposal entry (extensible, but start with the 4 known).

## Architecture / data flow
```
introspect (P03) ──▶ sample() ──▶ classify() ──▶ decision records (manifest)
                                                      │
                              agent reviews ──▶ decisions.json / interactive
                                                      │
                                          applyDecisions() ──▶ variant template render ──▶ write
```

## Related code files
Create (alongside phase-03 script):
- `scripts/lib/anomaly-detectors.mjs` (the 4 detectors + thresholds)
- `scripts/cube-templates/mf-users.dual-identity.yml.tmpl` (jus variant)
- `scripts/cube-templates/mf-users.no-role-name.yml.tmpl` (tf variant)
- pre-agg snippet for the high-scale mf_users variant (ptg)
Read: jus/cfm/tf mf_users files, ptg dir.

## Implementation steps
1. Write the 4 detectors with calibrated thresholds; each returns `{signal, value, triggered}`.
2. Build the 3 mf_users variant templates (clean from 03; dual-identity from jus; no-role-name).
3. High-scale detector attaches the pre-agg block to whichever cube exceeds the row threshold.
4. Decision-record emission + `--decisions` / `--accept-proposals` / interactive prompt.
5. applyDecisions → render + write only after decision; clean cubes unaffected.

## Todo
- [ ] 4 detectors + thresholds (jus@-suffix, tf null-role, ptg scale, dormant-sum)
- [ ] mf_users variant templates (3)
- [ ] High-scale pre-agg attachment
- [ ] Decision-record manifest + agent confirm path
- [ ] applyDecisions render/write gated on decision

## Success criteria
- Run against jus → flags dual-identity, proposes split_part merge; with `--accept-proposals` emits a
  mf_users equivalent to the current hand-tuned `jus/mf_users.yml` (modulo title/whitespace).
- Run against tf → flags role-name-absent, proposes plain sql_table (matches tf's intentional omission).
- Run against ptg → flags high-scale, attaches pre-agg to the mf_users it would emit.
- No anomalous cube is written without a recorded decision.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Threshold mis-fires on a new game (false anomaly) | Med×Med | Conservative thresholds from verified gaps (46.8% vs 0%); agent reviews every flag — false positive ≠ silent bad YAML. |
| Agent rubber-stamps a wrong proposal | Med×High | Decision record shows signal_value + alternatives; phase 07 validates compiled output regardless. |
| New anomaly type not in the 4 → silent clean emit of bad cube | Med×Med | Manifest lists signal values for ALL core tables so an unflagged oddity is still visible to the agent. |
| Dormant-sum backfilled later → double count reappears | Low×High | Detector keeps dims-only (no sum measure) until SUM>0 observed; finding 4. |

## Security considerations
- Sampling reads identity/PII columns (user_id @-suffix, role names). Aggregate-only outputs (counts, NULL-rates,
  percentages) in the manifest — never dump raw PII rows.

## Next steps
- Phase 06 consumes decisions per game during rollout (jus/tf/ptg are the anomalous tracks).
