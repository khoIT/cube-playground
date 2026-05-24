---
phase: 1
title: "Enum + types collapse"
status: completed
priority: P1
effort: "30m"
dependencies: []
---

# Phase 1: Enum + types collapse

## Overview

Shrink `TRUST_TIERS` from 5 values to 3 (`certified | draft | deprecated`). Server enum, FE mirror, and `TrustBadge` STYLES map drop `beta` and `orphaned`. Pure type/styling change — nothing renders differently yet because the YAML files still have old values (Phase 2 fixes that).

## Requirements

- Functional:
  - `TRUST_TIERS` constant updated in server (`server/src/types/business-metric.ts:23-29`) and FE mirror (`src/pages/Catalog/metrics-tab/business-metric-types.ts` + `business-metric-constants.ts`).
  - `TrustBadge` STYLES map (`src/shared/concept-shell/trust-badge.tsx`) keeps only the 3 surviving keys.
- Non-functional:
  - TypeScript compile is green across server + FE before merging.
  - No runtime behavior change yet (Phase 2 brings the YAML up to date).

## Architecture

Pure type collapse. No new modules. The Zod `z.enum(TRUST_TIERS)` already infers the union from the const array, so removing values from the array is the only edit on the server.

## Related Code Files

- Modify: `server/src/types/business-metric.ts` — drop `'beta'` and `'orphaned'` from `TRUST_TIERS` (lines 23-29).
- Modify: `src/pages/Catalog/metrics-tab/business-metric-types.ts` — same drop in FE mirror.
- Modify: `src/pages/Catalog/metrics-tab/business-metric-constants.ts` — same drop.
- Modify: `src/shared/concept-shell/trust-badge.tsx` — remove `beta` and `orphaned` keys from `STYLES` map.

## Implementation Steps

1. Edit `server/src/types/business-metric.ts:23-29`: keep only `'certified' | 'draft' | 'deprecated'`. Confirm Zod inference still compiles.
2. Edit FE `business-metric-types.ts` and `business-metric-constants.ts` mirrors identically.
3. Edit `trust-badge.tsx` STYLES: delete the `beta` and `orphaned` entries. Keep the existing `certified`, `draft`, `deprecated` styles unchanged (their colors already work: green / grey / amber).
4. `npx tsc --noEmit` and verify only unrelated pre-existing errors remain (the QueryBuilderV2 / rollup-designer noise is acceptable; new errors are not).
5. Do NOT touch YAMLs yet — those still have `beta`/`orphaned`. The Zod parser will reject them on next load; that's expected and resolved by Phase 2.

## Success Criteria

- [x] `TRUST_TIERS.length === 3` in server + FE.
- [x] `TrustBadge` STYLES has 3 keys.
- [x] TypeScript compile clean for the 4 modified files (no new errors).

## Risk Assessment

- Risk: untyped JSON fixtures or test files reference `'beta'` / `'orphaned'` and will fail Zod parse at runtime once loader reloads. Mitigation: Phase 2 (YAML sweep) runs immediately after; Phase 5 covers test fixture updates. If Phase 1 is merged separately, the loader will skip 45+ YAMLs with `[business-metrics] *.yml: Zod validation failed` — local dev will be broken until Phase 2 lands.
- **Mitigation:** Phases 1+2 should land in the same commit or PR. Treat them as one atomic change.
