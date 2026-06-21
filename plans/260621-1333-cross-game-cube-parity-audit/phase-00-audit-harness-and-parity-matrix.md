# Phase 0 · Audit harness + parity-matrix scaffolding

**Priority:** P0 (spine — every later phase consumes its output)
**Status:** pending

## Overview
Build the mechanical scaffolding that fans out over `(game × cube)` and emits a structured, re-runnable parity matrix + finding records. Without this, the audit is manual and unrepeatable. Reuse the metric-layer checkers that already exist; build only the **structural YAML-diff** layer they lack.

## Key insights
- Metric-layer coverage is already checkable (`audit:metric-trust`, `coverage` endpoint). What's MISSING is a structural diff of the cube YAMLs themselves (PK, joins, measure sql/type, rollup time-dim) against the prod oracle. That gap is the only new tool to build.
- A finding must be machine-addressable: `{game, cube, dimension: pk|join|measure|rollup|ratio|identity, severity, dev_value, oracle_value, file:line}`. JSON-lines so later phases can dedupe/sort programmatically.

## Requirements
- A read-only Node script `cube-dev/scripts/audit-cube-parity.mjs` that:
  1. Loads each dev cube YAML and (if it exists) its mapped prod oracle YAML.
  2. Extracts a normalized shape: cube name, sql_table/sql, primary_key expr, joins (name/relationship/sql), measures (name/type/sql), pre_aggregations (name/type/time_dimension/granularity/measures).
  3. Diffs dev vs oracle per dimension; emits findings JSONL to `plans/260621-1333-cross-game-cube-parity-audit/reports/parity-findings.jsonl`.
  4. Applies oracle-free **canonical rules** (additive-only rollup measures, ratio CAST DOUBLE, PK-not-obviously-unique heuristics, time-dim consistency) so muaw/ptg/pubg still get checked.
  5. Emits a `(game × cube)` coverage/parity matrix to `reports/parity-matrix.md`.
- Must NOT require a running Cube server (pure YAML static analysis); a later phase does the live compiled-SQL verification.

## Architecture
- `audit-cube-parity.mjs` reuses the YAML parse + canonical config already imported by `onboard-game-cube-model.mjs` / `lib/canonical-cube-config.mjs` (DRY — same normalization the generator uses).
- Mapping rule from `reports/audit-seed-and-constraints.md` (dev game → prod game-id, bare → prefixed name).
- Severity rubric: `correctness` (PK fan-out, non-additive rollup, time-dim mismatch, identity-join, ratio truncation) > `parity` (measure present in oracle/cfm but missing here) > `cosmetic` (label/desc/ordering).

## Related code files
- Create: `cube-dev/scripts/audit-cube-parity.mjs`
- Read: `cube-dev/scripts/lib/canonical-cube-config.mjs`, `cube-dev/scripts/onboard-game-cube-model.mjs`
- Create (output): `reports/parity-findings.jsonl`, `reports/parity-matrix.md`
- Add npm script: `cube-dev/package.json` → `"audit:cube-parity": "node scripts/audit-cube-parity.mjs"`

## Implementation steps
1. Write the YAML→normalized-shape extractor (handles `{CUBE}` macros, multi-line sql).
2. Implement dev↔oracle pairing via the mapping rule; record cubes with no oracle.
3. Implement per-dimension diff + canonical-rule checks.
4. Emit JSONL findings + markdown matrix.
5. Dry-run on cfm only; eyeball that the known jus recharge PK comes back CLEAN (it's fixed) and a deliberately-broken test cube comes back as a finding.

## Todo
- [ ] extractor for cube shape (pk/joins/measures/rollups)
- [ ] dev→oracle pairing + no-oracle list
- [ ] per-dimension diff + canonical rules + severity
- [ ] JSONL + matrix emitters
- [ ] npm script + dry-run sanity check

## Success criteria
- `npm run audit:cube-parity` runs clean (no crashes) over all 8 games and writes findings JSONL + matrix.
- jus `recharge` PK reports CLEAN (regression guard against summary-trust error).
- Each finding row is self-contained (`file:line`, dev vs oracle value, severity).

## Risks
- Multi-line / macro-heavy SQL hard to normalize → start with structural fields (pk/type/time_dim) that are high-signal; treat raw SQL diff as advisory not blocking.

## Next
Feeds Phase 1 (oracle games) and Phase 2 (oracle-less games) directly.
