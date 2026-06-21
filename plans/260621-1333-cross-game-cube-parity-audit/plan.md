# Cross-game Cube Model Correctness + Parity Audit & Fix

Systematic sweep of every per-game Cube YAML against the cube-prod validated oracle
(where one exists) and against canonical rules (everywhere), to find and fix real
correctness bugs and close cross-game parity gaps.

## Why
Recurring, documented bug classes already cost rework: measures referenced in metric
YAMLs that exist in no cube, `revenue_vnd_real` cfm-only, jus `transid` PK fan-out,
cfm vopenid identity-join breakage, rollup time-dim mismatches. These were found
one-at-a-time. This audit finds them all at once, mechanically, and proves each fix
against the oracle.

## Scope
- **Dev models (target of fixes):** `cube-dev/cube/model/cubes/{ballistar,cfm,cros,jus,muaw,ptg,pubg,tf}/*.yml` — 8 games, ~171 cube files.
- **Oracle (correct answer):** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/{cfm_vn,jus_vn,ballistar_vn,cros,tf}/` — 5 of 8 games covered.
- **No oracle:** muaw, ptg, pubg → internal-consistency + canonical-rule audit only (Phase 2).
- **Metric layer:** 73 business-metrics YAMLs + glossary + chat knowledge seed (Phase 3).

## Methodology (per the request)
fan-out per `(game × cube)` → diff vs oracle / canonical → **verify each finding against the actual prod file, not a summary** → classify (correctness vs parity vs cosmetic) → dedupe by root cause → parity matrix → fix → re-verify by compiled SQL.

## Phases
**Track A — audit engine + fixes** (the CLI/data spine)
| Phase | File | Status |
|-------|------|--------|
| 0 · Audit harness + parity-matrix scaffolding | [phase-00](phase-00-audit-harness-and-parity-matrix.md) | ✅ done (8 games, 373 findings; runtime oracle-availability) |
| 1 · Oracle-backed structural audit (cfm,jus,ballistar,cros,tf) | [phase-01](phase-01-oracle-backed-structural-audit.md) | ✅ done (verified ledger; all 8 now oracle-backed) |
| 2 · Oracle-less audit (muaw,ptg,pubg) | [phase-02](phase-02-oracle-less-internal-consistency-audit.md) | ✅ done (merged into ledger — oracles now exist for all 3) |
| 3 · Metric-layer parity audit | [phase-03](phase-03-metric-layer-parity-audit.md) | ✅ done (metric-trust: 425 certified · 129 GAP · 30 N/A; families split) |
| 4 · Dedupe, triage, fix worklist | [phase-04](phase-04-dedupe-triage-fix-worklist.md) | ✅ done ([fix-worklist](reports/fix-worklist.md); W1–W9, D1–D3 gate) |
| 5 · Execute fixes (generator-aware) | [phase-05](phase-05-execute-fixes.md) | ✅ done — W1 ptg + W2 pubg recharge version-dedup (ptg revenue 1.88× inflation fixed); W3/W4 measure backfill via cfm-template superset upgrade + regen of 4 gap games (parity 121→40, additive-only, cros/tf/muaw untouched). W7 N/A flags deferred. |
| 6 · Verification + regression gate | [phase-06](phase-06-verification-regression-gate.md) | ☐ pending (live compiled-SQL recompile needs Cube restart; CI gate + baseline) |

**Track B — persistent audit console UI** (consumes Track A; buildable in parallel after Phase 0)
| Phase | File | Status |
|-------|------|--------|
| 7 · Persistence: audit runs + findings + YAML snapshots | [phase-07](phase-07-persistence-audit-runs-findings-yaml-snapshots.md) | ✅ done (migration 067 + recorder, 6 tests, e2e verified) |
| 8 · Diff engine: dev↔prod-clone + version-to-version + upstream-staleness | [phase-08](phase-08-diff-engine-dev-vs-prod-and-versions.md) | ✅ done (cube-model-diff service + admin-gated /api/cube-parity routes; 9 diff tests; snapshot-backed) |
| 9 · Model Audit page (findings · diffs · trend) | [phase-09](phase-09-model-audit-ui-page.md) | ✅ done (4-tab page at /model-audit; heatmap + drawer + diff viewer + upstream + trend; lint clean; e2e smoke OK) |

Findings seed + cross-cutting constraints: [reports/audit-seed-and-constraints.md](reports/audit-seed-and-constraints.md)

## UI surface (Track B) — confirmed decisions
- **Prod comparison source:** the existing local clone at `/Users/lap16299/Documents/code/cube-prod` (already a checkout of `gitlab.gds.vng.vn/kraken/cube`). UI diffs against it; a "Refresh from kraken/cube" action runs `git -C cube-prod pull` and the page surfaces the upstream HEAD sha so it flags when the clone is behind.
- **History depth:** persist BOTH per-run finding snapshots AND a copy of each cube YAML per run → diffs and trend survive without git, self-contained. Live git diff is still offered as a fast path; persisted snapshots are the durable record.
- **Home:** new top-level page (working name **Model Audit**), built on the `DevAudit` tabbed-shell pattern (`src/pages/DevAudit/dev-audit-shell.tsx` + `audit-tabs.tsx`), design-system compliant (Dashboards/Segments header pattern, `tokens.css`).

## Key dependencies / hard constraints
- **Generator is source of truth for the 14 canonical cubes** (`cube-dev/scripts/onboard-game-cube-model.mjs` + `lib/canonical-cube-config.mjs`). Canonical-cube fixes go **in the generator + regenerate**, NOT hand-edited per game (else overwritten). Recharge/etl/role cubes are hand-authored per game — fix in place.
- **Verify fixes by compiled SQL, not `usedPreAggregations`** (lessons-learned).
- **Rollup measures must be additive; rollup time_dimension must match the query dimension** (dteventtime vs log_date).
- **DEV_MODE=false → restart cube_api + worker** for new rollups to route.
- Oracle is read-only reference; never edit cube-prod.
- Reuse existing checkers (`audit:metric-trust`, `check:metric-drift`, `/api/business-metrics/coverage`, `/api/glossary/integrity`) — do not rebuild the metric layer.
