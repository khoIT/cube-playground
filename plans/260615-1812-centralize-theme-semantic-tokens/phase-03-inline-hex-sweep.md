---
phase: 3
title: "Inline-Hex Sweep"
status: pending
priority: P2
effort: "2-3d"
dependencies: [0, 1]
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

- [ ] `grep -rE "#[0-9a-fA-F]{3,6}" src --include='*.tsx' --include='*.ts'` returns only allowlisted files.
- [ ] Phase 0 visual gate passes per area, light + dark (or intentional dark-mode fixes documented + baselines re-captured with rationale).
- [ ] New semantic tokens (if any) defined in `tokens.css` for both themes; none orphaned.
- [ ] `npx tsc --noEmit` clean; existing vitest suites green.

## Risk Assessment

- **Risk:** snapping a one-off hex to a near-but-not-equal token causes subtle visible shift. **Mitigation:** only auto-snap on exact resolved-value match; otherwise add a token or flag for review.
- **Risk:** 161-file scope balloons / partial state. **Mitigation:** area batches are independently shippable; plan can pause between areas without leaving the app broken (semantic tokens + remaining hex coexist).
- **Risk:** data-viz colors wrongly tokenized break chart legibility. **Mitigation:** treat categorical palettes as a distinct bucket → `--chart-*` or allowlist, never `--text-*`/`--bg-*`.
