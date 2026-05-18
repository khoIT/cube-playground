---
phase: 4
title: "Identify step — tag combo + find-similar"
status: pending
priority: P2
effort: "1d"
dependencies: [3]
---

# Phase 4: Identify step — tag combo + find-similar

## Overview

Fill in the Identify step with two new features: (1) a TagCombo input — pick from existing tags + type to create new, (2) a find-similar warning between Operation and Of (mounted in the Define step) that flags existing measures matching `aggType + sourceCube`.

## Requirements

- **Functional:**
  - TagCombo shows existing tags as suggestions (aggregated from `/meta` across all measures)
  - User can pick from suggestions OR type-and-Enter to create a new tag
  - Tags render as removable chips; duplicates rejected by validation
  - Find-similar warning collapsible card lists matched measures with name + title + Open-in-Playground link
  - Match strategy: same `sourceCube` + same `aggType` (cube convention map: count, countDistinctApprox, sum, avg, min, max, ratio); rendered only when matches non-empty
- **Non-functional:**
  - Combo accessible (keyboard nav, escape clears typing)
  - Suggestion list capped at 50 (no virtualization)

## Architecture

```
StepIdentify
├── Name input
├── Title input
├── Description textarea
├── TagCombo  ← new
└── Format select

StepDefine (modify to add warning between Operation and Of)
├── Source
├── Operation
├── FindSimilarWarning  ← new (renders only if matches > 0)
├── Of
└── Filter
```

```ts
// useExistingTags() reads from AppContext.meta, aggregates union of meta.tags from every measure
function useExistingTags(): string[] { ... }

// useFindSimilar(sourceCube, operation) returns Measure[] from meta where:
//   measure.cubeName === sourceCube && mapOperationToAggType(operation) === measure.aggType
```

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/NewMetric/sections/identity-section.tsx` — add TagCombo below description
  - `src/QueryBuilderV2/NewMetric/sections/operation-section.tsx` — no changes, but step-define wraps it with the warning
  - `src/QueryBuilderV2/NewMetric/steps/step-define.tsx` — mount `<FindSimilarWarning>` between Operation and Of
- **Create:**
  - `src/QueryBuilderV2/NewMetric/components/tag-combo.tsx` — input with chip list + suggestion popup
  - `src/QueryBuilderV2/NewMetric/components/find-similar-warning.tsx` — collapsible warning card
  - `src/QueryBuilderV2/NewMetric/hooks/use-existing-tags.ts` — aggregate tags from `meta`
  - `src/QueryBuilderV2/NewMetric/hooks/use-find-similar.ts` — filter meta by sourceCube + aggType
  - `src/QueryBuilderV2/NewMetric/components/__tests__/tag-combo.test.tsx`
  - `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-find-similar.test.ts`
- **Read for context:**
  - `src/components/AppContext.tsx` — meta shape after P1's extended fetch

## Implementation Steps

1. Implement `useExistingTags`: iterate `meta.cubes[].measures[].meta?.tags`, union, sort alphabetically. Memoize on meta identity.
2. Build `TagCombo` (~150 lines):
   - Controlled by `draft.tags` + `setField('tags', ...)`
   - Input field below current chips; typing filters suggestions (case-insensitive contains)
   - Enter creates new tag if not duplicate; clicks suggestion to add
   - Chip removal via × button or Backspace when input empty
   - Pure UI; persistence is via draft state → YAML emission (P2 already handles)
3. Implement `useFindSimilar`: build operation→aggType map (`sum`→`sum`, `countDistinct`→`countDistinctApprox`, etc — verify against actual cube measures); filter `meta.cubes[].measures[]` by sourceCube + aggType.
4. Build `FindSimilarWarning`: collapsible card (default expanded when matches > 0). Shows up to 5 matches with `name`, `title`, and a "Use existing" button that closes the wizard + selects the existing measure in QueryBuilder (deferred — for POC, just show name + title).
5. Mount in step-define between Operation and Of.
6. Tests:
   - TagCombo: add/remove/duplicate-reject
   - useFindSimilar: returns matches; returns empty for unmatched op
   - Snapshot test for TagCombo with 0 / 1 / 5 chips + suggestions visible

## Success Criteria

- [ ] User can pick existing tag from dropdown
- [ ] User can type a new tag + Enter creates chip
- [ ] Duplicate tag rejected silently
- [ ] Find-similar warning appears when sourceCube + operation matches existing measures
- [ ] Warning hidden when no matches
- [ ] All P2/P3 tests still pass

## Risk Assessment

- **Risk:** Operation→aggType map drifts from real Cube internals — mitigation: derive from `meta.cubes[].measures[].aggType` empirically; document map in code comments.
- **Risk:** Suggestion list noisy if tag taxonomy isn't seeded — mitigation: cap at 50 + alphabetical sort; user can ignore.
- **Risk:** "Use existing" button complexity creeps — mitigation: POC just shows match info; deep-link to existing measure deferred.

## Security Considerations

- Tag input is free-form; sanitize via YAML emission (already escaped by js-yaml). No XSS risk in chip rendering (React escapes by default).
