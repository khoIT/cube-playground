---
phase: 5
title: "Trust filter chip restyle"
status: completed
priority: P3
effort: "1h"
dependencies: [1, 4]
---

# Phase 5: Trust filter chip restyle

## Overview

In the metrics filter rail, the Trust filter row renders generic `FilterPillRow` chips while metric cards use the colored `TrustBadge` (green / grey / amber). Make the rail chip look identical to the card chip so users can pick a chip by recognising its color, not just its label.

## Requirements

- Functional:
  - The Trust row in `metrics-filter-rail.tsx` renders each trust option using the `TrustBadge` component (or a thin selectable wrapper around it that preserves the badge styling for ON state and dims it for OFF state).
  - Clicking a chip toggles selection (same behavior as today's `FilterPillRow`).
  - Selected vs unselected state visually distinguishable (suggested: full color when selected, ~40% opacity + grey border when unselected).
- Non-functional:
  - No duplication of the trust color palette — `TrustBadge` STYLES remains the only source of truth.
  - Other filter rows (Domain, etc.) keep their existing `FilterPillRow` styling — only Trust gets the special treatment.

## Architecture

Two viable paths; pick the cleaner at implementation time:

**Option A — Promote `TrustBadge`** by adding optional `selected` + `onClick` props. Renders as a `<button>` when interactive; selected uses current colors; unselected uses muted/outlined variant. The filter rail uses it directly via `.map(trust => <TrustBadge trust={trust} selected={...} onClick={...} />)`.

**Option B — New thin wrapper** `src/pages/Catalog/metrics-tab/trust-filter-chip.tsx` that internally renders a `TrustBadge` and adds the click/selected affordance. Keeps `TrustBadge` purely presentational.

Default: **Option A** (KISS — one component, one place for styling). Fall back to B if `TrustBadge` is consumed by surfaces where adding `onClick` would muddy the API.

## Related Code Files

- Modify: `src/shared/concept-shell/trust-badge.tsx` — add optional `selected?: boolean`, `onClick?: () => void`, render as `<button>` when `onClick` is set. Default: behave exactly as today.
- Modify: `src/pages/Catalog/metrics-tab/metrics-filter-rail.tsx` — replace the Trust `FilterPillRow` with a small `<div role="group">` mapping over `TRUST_TIERS` and rendering `<TrustBadge>` per option.
- Read for context: `src/shared/concept-shell/trust-badge.tsx` (post-Phase-1 STYLES map with 3 keys).
- Read for context: `metrics-filter-rail.tsx` lines around 145-160 (current Trust row).

## Implementation Steps

1. Extend `TrustBadge` with `selected?: boolean` and `onClick?: () => void`. When `onClick` is provided:
   - Render as `<button type="button">` instead of `<span>`.
   - Apply opacity 0.4 + grey border override when `selected === false`.
   - Apply full colors (current behavior) when `selected !== false`.
2. In `metrics-filter-rail.tsx`, replace the Trust `FilterPillRow` block:
   ```tsx
   <FilterRow label="Trust">
     {(TRUST_TIERS as BusinessMetricTrust[]).map((trust) => (
       <TrustBadge
         key={trust}
         trust={trust}
         size="sm"
         selected={filters.trusts.has(trust)}
         onClick={() => set('trusts', toggle(filters.trusts, trust))}
       />
     ))}
   </FilterRow>
   ```
   (Re-use whatever local label wrapper exists; if `FilterPillRow` is the only layout wrapper, lift the label/row chrome out into a tiny local `FilterRow` helper or pass children to a slightly-extended `FilterPillRow`.)
3. Visual smoke: open `/data-model` → Metrics tab → filter rail. Trust row should show 3 chips in the canonical colors (green, grey, amber). Click a chip → it gains full opacity; others dim. Selection drives the existing filter predicate (no logic change).
4. Update any test that asserts the rail's Trust row markup (likely `metrics-filter-rail.test.tsx` if it exists).

## Success Criteria

- [x] `TrustBadge` supports an interactive selected mode without behavior regression for read-only callers.
- [x] Trust filter row in the rail visually matches the metric-card chip palette (eyeball: green / grey / amber, same border radius, same font).
- [x] Clicking chips toggles filter state correctly (existing tests still pass).
- [x] `Show deprecated` toggle still behaves as before.

## Risk Assessment

- Risk: making `TrustBadge` interactive changes its accessibility surface (now focusable). Mitigation: render as `<button>` only when `onClick` is set; existing `<span>` callers stay non-focusable.
- Risk: opacity-dim approach reduces contrast for unselected chips below WCAG AA. Mitigation: pair the opacity drop with a grey background override (`bg: T.n100`) for stronger differentiation; verify contrast.
- Risk: the dimmed "deprecated" amber loses visual cue. Mitigation: keep border color at full saturation even when dimmed (only background + text dim).
