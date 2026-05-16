---
phase: 2
title: "Draft state + YAML generator extensions"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: Draft state + YAML generator extensions

## Overview

Extend `NewMetricDraft` with `tags`, `previewTimeDimension`, `previewRange`. Extend `generate-measure-yaml.ts` to emit a `meta:` block carrying tags + provenance (`source: wizard`, `author: khoitn`, `created_at`). No UI changes yet — pure data-layer extensions consumed by later phases.

## Requirements

- **Functional:**
  - `NewMetricDraft` carries tags array + preview metadata
  - `generate-measure-yaml.ts` emits a `meta:` block when tags non-empty (always emits `source/author/created_at`)
  - YAML output validates against Cube schema (round-trip readable by Cube)
  - Reducer + reset cover new fields
  - Validation reports tag-format errors (free-form initially, but disallow whitespace-only)
- **Non-functional:**
  - Tests for YAML output with/without tags
  - No breakage of existing wizard

## Architecture

```ts
// types.ts
export type NewMetricDraft = {
  // ... existing
  tags: string[];
  previewTimeDimension: string | null;
  previewRange: '7d' | '30d';
};

// generate-measure-yaml.ts emits:
- name: my_metric
  type: count
  sql: "{cube}.col"
  title: "..."
  description: "..."
  format: number
  meta:
    source: wizard
    author: khoitn
    created_at: 2026-05-16T19:40:00Z
    tags:
      - revenue
      - daily
```

`meta` block omitted entirely if there are no tags AND no provenance fields — but provenance is always emitted (POC decision), so the block is always present for wizard-authored measures.

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/NewMetric/types.ts` — add fields
  - `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` — extend INITIAL_DRAFT + validation
  - `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` — emit `meta:` block
  - `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml.test.ts` — add cases for tags + provenance
  - `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-draft.test.ts` — test new field reducer cases
- **Read for context:**
  - `vite-plugins/yaml-splice.ts` — splice contract (already supports arbitrary patch strings)

## Implementation Steps

1. Add `tags: string[]`, `previewTimeDimension: string | null`, `previewRange: '7d' | '30d'` to `NewMetricDraft`.
2. Update `INITIAL_DRAFT`: `tags: []`, `previewTimeDimension: null`, `previewRange: '7d'`.
3. Extend validation: reject tags containing whitespace-only or duplicate entries (case-sensitive — `Revenue` vs `revenue` are distinct, per YAGNI).
4. In `generate-measure-yaml.ts`, append `meta:` block. Format:
   ```yaml
       meta:
         source: wizard
         author: khoitn
         created_at: <ISO timestamp passed in at generation time>
         tags: [tag1, tag2]
   ```
   Inline-array style for short tag lists, block-array for >3. Use existing indentation helpers.
5. Pass `createdAt: new Date().toISOString()` from `use-metric-yaml.ts` to keep generator pure.
6. Tests:
   - tags empty → `tags:` line omitted, `source/author/created_at` present
   - tags = ['a', 'b'] → inline array
   - tags = ['a','b','c','d'] → block array
   - timestamp roundtrip stable

## Success Criteria

- [ ] All new field updates flow through `setField` and reducer
- [ ] YAML output for a tagged measure parses back via js-yaml in tests
- [ ] Existing YAML tests still pass
- [ ] No UI regressions (wizard still opens — even if tag input UI doesn't exist yet)

## Risk Assessment

- **Risk:** YAML indentation mismatch with existing `splice()` — mitigation: tests against fixture cubes; visually verify splice output in dev before P3 lands.
- **Risk:** `created_at` non-deterministic in tests — mitigation: inject as parameter; default to `new Date().toISOString()` at call site only.

## Security Considerations

- `author` hardcoded to `khoitn` (POC). Documented in plan-level Key Decisions.
