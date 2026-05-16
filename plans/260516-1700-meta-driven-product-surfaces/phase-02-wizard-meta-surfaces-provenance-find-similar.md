---
phase: 2
title: "Wizard meta surfaces: provenance + find-similar"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Wizard meta surfaces — provenance + find-similar

## Context Links

- Wizard YAML generator: `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts`
- Wizard sections: `src/QueryBuilderV2/NewMetric/sections/`
- Wizard dialog: `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`
- Hybrid sync architecture (provenance rationale): [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md) §3.3 (`measure_kind: raw | derived` column)

## Overview

Two independent features both consume the extended `/meta` payload unlocked by P1:

- **2a. Provenance stamping** — every wizard-authored measure gets a `meta: { source: wizard, author: khoitn, created_at }` block in the emitted YAML. Foundation for future filtering, MM-01 provenance, and "wizard-authored" chip in the catalog.
- **2b. Find-similar nudge** — between Operation and Of sections, a soft warning surfaces when the draft pattern matches existing measures (same `aggType`, same source cube, same column reference). Non-blocking; encourages reuse without preventing intentional duplication.

## Priority

P1 — high-leverage product feature. Directly addresses the use case the cancelled catalog plan was trying to solve, inside the only flow that matters (authoring).

## Key Insights

- `generate-measure-yaml.ts:135-144` already builds `entries` array with stable insertion order — adding a `['meta', {...}]` entry is one line.
- `aggType` (59/59 populated) + `sourceCube` + parsed `ofMember` give a 3-key pattern that uniquely fingerprints measure intent. Match probability is high enough to be useful, low enough not to be noisy.
- `description` is 36% populated on measures — show it in the find-similar list when present, fall back to title otherwise.
- User goal: "Reload automatically. User may add new metrics into yaml via current new metrics flow" — already wired via `AppContext.refreshMeta()` after wizard save. Provenance shows up in next fetch automatically.
- Hardcoded `author: 'khoitn'` per leadership decision. Document the const so future wiring is one find-and-replace.

## Requirements

### 2a. Provenance stamping

**Functional:**
- YAML generator emits a `meta:` block as the LAST key in the measure mapping (so it's visually grouped under user-authored content).
- `meta.source = 'wizard'`, `meta.author = 'khoitn'`, `meta.created_at = ISO8601` (UTC).
- YAML preview pane (`yaml-preview.tsx`) shows the meta block.
- After save + refetch, the new measure's `meta` field is populated in the `/meta` payload (visible in browser devtools).

**Non-functional:**
- Author const lives in a single module — easy swap when real user-context wiring lands.
- No new dependency; uses existing `js-yaml` round-trip.

### 2b. Find-similar nudge

**Functional:**
- New hook `use-similar-measures(draft)` returns up to 5 existing measures matching: same `sourceCube`, same `aggType` (derived from `draft.operation` via the existing `OPERATION_TYPE` map), AND `sql` reference target overlapping `draft.ofMember`.
- New section `SimilarMeasuresSection` renders between Operation and Of. Hidden when 0 matches. Collapsible. Shows: `cubeName.measureName`, aggType chip, description (or title fallback).
- Clicking a similar-measure row opens a tooltip with full description + format. Does NOT replace the draft (intentional duplication still possible).
- Non-blocking: wizard's Save flow ignores this section entirely.

**Non-functional:**
- Pure function over already-loaded `cubes` state — no extra fetch.
- Memoized on `(draft.operation, draft.sourceCube, draft.ofMember)`.

## Architecture

```
draft (NewMetricDraft)
   ├─ Provenance:   generate-measure-yaml.ts ──▶ append ['meta', {source, author, created_at}]
   │                                                  └─▶ YAML preview + saved file
   │
   └─ Find-similar: use-similar-measures(draft, cubes)
                       │  filter cubes[*].measures[*] where
                       │    aggType === OPERATION_TYPE[draft.operation]
                       │    AND cubeName === draft.sourceCube
                       │    AND sql refs ofMember (string contains check)
                       ▼
                    SimilarMeasuresSection
                       └─ collapsible list of up to 5 matches
```

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` — add `['meta', { source, author, created_at }]` entry; export a `WIZARD_PROVENANCE_AUTHOR` const for future wiring
  - `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` — render `SimilarMeasuresSection` between Operation and Of
- **Create:**
  - `src/QueryBuilderV2/NewMetric/hooks/use-similar-measures.ts` — match hook
  - `src/QueryBuilderV2/NewMetric/sections/similar-measures-section.tsx` — UI
- **Read for context:**
  - `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml.test.ts` — extend tests

## Implementation Steps

### 2a. Provenance

1. Add `WIZARD_PROVENANCE_AUTHOR = 'khoitn'` const at top of `generate-measure-yaml.ts`. Brief comment: hardcoded for POC; replace with `AppContext.identifier` once that field is verified populated end-to-end.
2. In `generate()`, append after the existing `if (filtersValue) entries.push(['filters', filtersValue]);`:
   ```ts
   entries.push(['meta', {
     source: 'wizard',
     author: WIZARD_PROVENANCE_AUTHOR,
     created_at: new Date().toISOString(),
   }]);
   ```
3. Extend `generate-measure-yaml.test.ts` to assert the `meta:` block is emitted with all three keys for a sample draft.
4. Manual verify: open wizard, fill in a sample metric, observe YAML preview shows the `meta:` block, save, observe the persisted YAML file in `cube-dev/cube/model/cubes/*.yml`.

### 2b. Find-similar

5. Create `use-similar-measures.ts`. Hook signature: `(draft: NewMetricDraft) => SimilarMatch[]` where `SimilarMatch = { cubeName, measureName, aggType, description?, title?, formatDescription? }`.
6. Implementation: read `cubes` from `useQueryBuilderContext()`. Filter `cubes.find(c => c.name === draft.sourceCube)?.measures`. Match each measure where `m.aggType === OPERATION_TYPE[draft.operation]` AND (`draft.ofMember` is null OR `m.sql && m.sql.includes(extractColumn(draft.ofMember))`). Limit 5. Sort by description-present first.
7. Edge case: `m.sql` is NOT exposed by `/cubejs-api/v1/meta` (0/59 populated per probe). So the sql-overlap check will never match. **Adjust strategy:** match on `aggType` + `sourceCube` only. This is intentionally loose — surfaces all measures of the same aggType in the same cube. For ballistar_vn that means at worst 4 matches (the 4 countDistinctApprox measures in `active_daily`). **Ranking (Validation Session 1):** sort matches with `description`-present first, then alphabetical by `measureName`. Description-present-first surfaces documented peers (the high-trust signal) at the top; alphabetical is the stable tiebreaker.

   <!-- Updated: Validation Session 1 - ranking strategy confirmed: docs-first then alphabetical, not pure alphabetical or recency-based -->

8. Create `similar-measures-section.tsx`. UI: collapsible group, header `"N existing measures use {aggType} on this cube"`. Each row: cube.member name (mono font), aggType chip, description (line-clamp 1) or title fallback. Click → opens existing `ItemInfoIcon`-style tooltip with full description + format.
9. Wire into `NewMetricDialog.tsx` between `OperationSection` and `OfSection`. Conditionally render only when matches > 0 and sourceCube is selected.
10. Visual smoke: pick `active_daily` + `countDistinctApprox`. Verify 4 similar measures surface (`dau`, `mau`, `mau_prev_month`, `active_servers`).

## Todo List

- [ ] Add `WIZARD_PROVENANCE_AUTHOR` const + meta entry in YAML generator
- [ ] Extend YAML generator test for meta block
- [ ] Manual: wizard save → confirm meta block in persisted YAML
- [ ] Create `use-similar-measures.ts` hook
- [ ] Create `SimilarMeasuresSection` component
- [ ] Wire section into `NewMetricDialog.tsx`
- [ ] Smoke: `active_daily` + `countDistinctApprox` → 4 matches shown
- [ ] Smoke: brand-new operation/cube combo → section hidden

## Success Criteria

- [ ] Every wizard-saved measure carries `meta: { source: wizard, author: khoitn, created_at }` in the YAML file
- [ ] `/meta` payload after refetch shows the new measure's `meta` field populated
- [ ] Find-similar section surfaces matches for known overlaps (4 cubes × known agg patterns)
- [ ] Find-similar section is hidden when sourceCube has zero same-aggType peers
- [ ] No regression on existing wizard Save/Validate/dry-run flows

## Risk Assessment

- **Risk:** `meta` key in YAML breaks the existing yaml-splice handler. Mitigation: `yaml-splice.ts` operates on the `measures:` array; the meta block is just another field on the measure mapping — handler is field-agnostic. Verify with unit test.
- **Risk:** find-similar match too loose, noise drowns signal. Mitigation: limit 5; sort description-present-first; if feedback says too noisy, narrow to `aggType + name token overlap`.
- **Risk:** `OPERATION_TYPE` map missing an entry, `aggType` lookup undefined. Mitigation: existing map covers all 7 operations; default to no matches if undefined.

## Security Considerations

- `meta.author: 'khoitn'` is intentionally not user-derived. No PII leakage from the UI surface.
- No new network surface; `use-similar-measures` reads already-loaded cubes state.
