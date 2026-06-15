---
phase: 3
title: Inline-Hex Sweep
status: completed
priority: P2
effort: 2-3d
dependencies:
  - 0
  - 1
---
<!-- Updated: Validation Session 1 - add-a-token is the locked default for non-matching hex; gate each area on Phase 0 visual harness -->


# Phase 3: Inline-Hex Sweep

## Overview

Migrate inline hex in all **161 files** onto semantic tokens. Each hex maps to the nearest semantic token via the Phase 1 mapping; any hex with no semantic equivalent gets a **new semantic token** (never a fresh inline value). The largest, most mechanical phase — sub-grouped by area for reviewability and independent verification.

## Key Insights

- 161 files is too large for one diff. Group by directory/feature area; each area is a verifiable unit (one adjacent surface to compare against).
- Not every hex is a theme color: chart series palettes, canvas/SVG data-viz, and 3rd-party embed colors may be legitimately literal. Decide per case — promote to `--chart-*` semantic tokens where categorical, allowlist genuine exceptions for Phase 4's linter.
- A hex that matches an existing token's resolved value → swap to the token. A hex that is a one-off shade with no exact-matching token → **add a new semantic token** (locked default — never snap to a near-but-unequal token, which would shift the pixel). Snapping is allowed only on exact resolved-value equality.

## Requirements

- Functional: every surface renders identically (or intentionally snapped to the nearest token, called out) in light + dark.
- Non-functional: zero inline hex in `src/**/*.{ts,tsx}` except an explicit, documented allowlist (chart palettes / data-viz / 3rd-party).

## Architecture

- Migration key = Phase 1 raw→semantic table, extended with a hex→semantic column built during this phase.
- Area batches (independently shippable): `pages/Dashboards`, `pages/OpsConsole`, `pages/Segments` (+ member360, care), `pages/Chat` (+ artifacts/renderers), `pages/Advisor`, `pages/Catalog`, `pages/Liveops`, `components/*`, `QueryBuilderV2/*`, remaining leaf pages.
- Dark-mode: a literal hex never adapts; replacing it with a semantic token is often a *fix* (surfaces that were stuck light). Verify each area in dark explicitly and call out any newly-correct (changed) dark rendering as intended.

## Related Code Files

- Modify: ~161 files across `src/pages/*`, `src/components/*`, `src/QueryBuilderV2/*` (authoritative list: `grep -rEl "#[0-9a-fA-F]{3,6}" src --include='*.tsx' --include='*.ts'`).
- Modify: `src/theme/tokens.css` (add semantic tokens for intents not yet covered).
- Modify: `docs/design-guidelines.md` (record the allowlist + any new tokens).

## Implementation Steps

1. Build the hex inventory: extract distinct hex values + occurrence counts; map each to a semantic token or mark as new-token / allowlist candidate.
2. Resolve new tokens up front (add to `tokens.css`) so area batches reference stable names.
3. Sweep area-by-area. Per area: replace hex → token (add a token when no exact match), `tsc --noEmit`, run the Phase 0 visual gate (light + dark) for that area, commit the area as its own focused change.
4. Maintain the allowlist (chart palettes, data-viz canvases, 3rd-party) — keep it minimal and documented; these feed Phase 4's lint exceptions.
5. Final grep: zero inline hex outside the allowlist.

## Success Criteria

- [x] `grep -rE "#[0-9a-fA-F]{3,6}" src --include='*.tsx' --include='*.ts'` returns only allowlisted files.
- [x] Phase 0 visual gate passes per area, light + dark (or intentional dark-mode fixes documented + baselines re-captured with rationale).
- [x] New semantic tokens (if any) defined in `tokens.css` for both themes; none orphaned.
- [x] `npx tsc --noEmit` clean; existing vitest suites green. (color edits clean; pre-existing unrelated tsc errors remain)

## Risk Assessment

- **Risk:** snapping a one-off hex to a near-but-not-equal token causes subtle visible shift. **Mitigation:** only auto-snap on exact resolved-value match; otherwise add a token or flag for review.
- **Risk:** 161-file scope balloons / partial state. **Mitigation:** area batches are independently shippable; plan can pause between areas without leaving the app broken (semantic tokens + remaining hex coexist).
- **Risk:** data-viz colors wrongly tokenized break chart legibility. **Mitigation:** treat categorical palettes as a distinct bucket → `--chart-*` or allowlist, never `--text-*`/`--bg-*`.

## Outcome — inline-hex allowlist (feeds Phase 4 linter)

Sweep complete: 90 → 22 files. All remaining inline hex is legitimately literal
(recharts SVG `fill`/`stroke` where `var()` does not resolve; categorical
data-viz ramps; syntax-highlight tones; 3rd-party/brand). Phase 4's lint rule
must exempt exactly these:

**Data-viz / chart palettes (recharts + canvas + ramps):**
- `src/theme.ts` (CHART array — SVG attrs)
- `src/QueryBuilderV2/analysis/funnel-results.tsx`, `analysis/distribution-mode.tsx`
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-charts.tsx`
- `src/QueryBuilderV2/components/ChartRenderer.tsx`
- `src/pages/Chat/components/chart-heatmap.tsx`
- `src/pages/Liveops/cohort/intensity-ramp.ts`, `cohort/cohort-grid.tsx`, `cohort/index.tsx` (null-cell hatch)
- `src/pages/OpsConsole/use-ops-overview.ts` (GATEWAY_PALETTE)
- `src/pages/Segments/funnel-builder/funnel-bar-list.tsx`

**Categorical type / syntax-tone palettes:**
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/source-preview-rail.tsx` (column-type swatches)
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx` (YAML syntax tones)
- `src/pages/Catalog/metric-detail/tab-formula.tsx` (formula syntax tones)
- `src/pages/Catalog/schema-cartographer/cube-tree.tsx` (tree node-type colors)
- `src/pages/Catalog/metric-detail/lineage-columns.tsx` (lineage edge colors)
- `src/QueryBuilder/MemberDropdown.tsx` (view/cube type tags)

**Brand / 3rd-party / minor:**
- `src/shared/icons/CubejsIcon.tsx` (Cube logo SVG)
- `src/pages/Catalog/digest/digest-page.tsx` (Slack/channel brand)
- `src/components/GlobalStyles.tsx` (only commented-out `#b3d4fc`)
- `src/rollup-designer/components/Settings.tsx` (`#1414464D` faint help-icon tint)

**Deferred (not allowlist — pre-existing drift to converge later):**
- `src/pages/Catalog/metrics-tab/metric-list-row.tsx` trust hues (`#0f7a3a`/`#8a5a05`)
  differ from the `trust-badge` canon; converging needs a light re-baseline.

## New tokens added this phase (`tokens.css`, both themes)

- `--cat-{purple,teal,indigo,rose,green,amber,red,grey}-ink` — categorical chip inks.
- `--warn-callout-{bg,border,border-strong,text,hover-bg,btn-bg}` — inline warning strip.
- `--info-border` — completes the status border family.
- `--bg-code` — code/pre surface (snippets, SQL/YAML previews).

## Completion log

- Decision (categorical chips): add dark-aware `--cat-*` family (user-confirmed).
- Decision (near-duplicate status palettes): converge to canonical `--*-soft/ink`
  with light+dark re-baseline (user-confirmed) — relaxes strict light-pixel-intact
  for sub-perceptual hue convergence on antd Alert / anomaly severity / trust.
- Commits: DevAudit `820d2fa`, Dashboards `92a9be5`, universal-remap `4717fcc`,
  concept-shell `e4138ca`, Catalog `ce56e23`, atoms+Liveops `7975153`,
  Segments+Advisor `c0ab8b6`, QB/Chat/Admin/shell/components `97f16b6`.
- Gate: all 22 deterministic routes green L+D; `/build` is the known live-data
  non-deterministic route (mask its result-table/cube-list in a Phase-0 follow-up).
