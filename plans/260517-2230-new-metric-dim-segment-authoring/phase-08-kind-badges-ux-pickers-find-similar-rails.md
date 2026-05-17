---
phase: 8
title: "Kind badges UX pickers find-similar rails"
status: completed
priority: P2
effort: "0.75d"
dependencies: [7]
---

# Phase 8: Kind badges UX pickers find-similar rails

## Overview

Cross-kind same-name is allowed (locked decision). UX disambiguates with a small **kind badge** rendered next to every entry that surfaces in the wizard: column dropdowns, filter-tree leaf rows, find-similar warnings, YAML preview rail header. Single shared `KindBadge` component, used everywhere entries are listed.

**Red-team applied:** F-8 (`useReachableMembers` split — don't pollute filter-tree column dropdown with segments), F-9 (cross-kind similarity rule for find-similar).

## Requirements

- **Functional:**
  - `<KindBadge kind="measure" | "dimension" | "segment" />` renders a compact tag near any entry name.
  - Badges visible in:
    - Measure-mode Step 3 column picker (each row).
    - Filter-tree column dropdown (each option) — measure-mode Step 4 + segment-mode middle step.
    - `find-similar-warning` — show kind of each similar entry.
    - YAML preview rail — header chip near the entry name (or section header).
    - Identity step right rail — chip near the name field showing kind being authored.
  - Badge styles distinct enough to read at a glance (color + glyph + label).
- **Non-functional:**
  - Badge ≤ 50 lines (small, focused component).
  - Reused, not forked, across surfaces.
  - Accessible: meaningful `aria-label` so screen readers announce "measure / dimension / segment".

## Architecture

```
src/QueryBuilderV2/NewMetric/components/
└── kind-badge.tsx          (NEW — shared)

usages:
- find-similar-warning.tsx       (modify)
- step-3-column/slot-picker.tsx  (modify — show badge per option)
- step-4-filters/filter-leaf-row.tsx (modify — badge in column dropdown)
- yaml-preview-rail.tsx          (modify — header chip)
- identity-section.tsx OR step-5-identity/identity-body.tsx (modify — chip near name field)
```

Badge visual (tentative):

```
[M] measure   green pill
[D] dimension blue pill
[S] segment   purple pill
```

Final style decided at implementation time — cosmetic.

## Related Code Files

- Create: `src/QueryBuilderV2/NewMetric/components/kind-badge.tsx`
- Create: `src/QueryBuilderV2/NewMetric/components/__tests__/kind-badge.test.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/components/find-similar-warning.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-3-column/slot-picker.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-4-filters/filter-leaf-row.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/identity-body.tsx`
- Read for context: existing `find-similar-warning.tsx`, `slot-picker.tsx`, `filter-leaf-row.tsx`.

## Implementation Steps (TDD — tests first)

1. **Write failing tests for `KindBadge`:**
   - Renders the right glyph + label per kind.
   - `aria-label` populated correctly.
   - Compact mode (short pill) vs labeled mode (full word) — both render-paths.
2. **Write failing integration tests:**
   - `slot-picker` shows a badge on each option row.
   - `filter-leaf-row` shows a badge in the column dropdown.
   - `find-similar-warning` shows the kind of each similar entry.
   - YAML preview rail header includes a badge.
3. **Implement `KindBadge`** as a styled component (Lucide icon + label). Accept `kind` prop + optional `compact: boolean`.
4. **Wire into `slot-picker.tsx`** — render badge before each member name. Member's kind comes from `useReachableMembers` (measures + dims only — see split below).
4a. **Split `useReachableMembers` (red-team F-8):**
   - `useReachableMembers` stays unchanged (dims + measures). It's used by filter-tree column dropdowns (measure-mode Step 4, segment-mode tree); segments must NEVER appear in column dropdowns (they aren't filterable members — they ARE filters).
   - Add `useReachableSegments(cubes)` returning `{ qualifiedName, shortName, cubeName, description? }[]`. Used only by: find-similar warnings, YAML preview rail segment-list (if any), badge surfaces that list segments.
   - Extend `WizardCube` type with `segments?: WizardSegment[]`; populate from `/meta?extended=true` (verify shape during P1 spike). If Cube version doesn't expose segments in `/meta`, `useReachableSegments` returns `[]` and find-similar across kinds is a graceful no-op.
5. **Wire into `filter-leaf-row.tsx`** — column dropdown options show badge **for dims/measures only**; segments never appear in this dropdown.
6. **Wire into `find-similar-warning.tsx` (red-team F-9):** cross-kind similarity rule for v1 is **name-token overlap** (lowercased, split on `_`, intersect token sets, threshold ≥1 shared non-stopword token). Measure→measure match also keeps existing `aggType` rule. Update `useFindSimilar` to dispatch:
   - measure-mode auto-name → match measures (existing) + warn on segments/dims with same name-tokens.
   - dim-mode auto-name → match dims with same name-tokens + warn on measures/segments with same name.
   - segment-mode auto-name → match segments with same name-tokens + warn on measures/dims with same name.
   - If `useReachableSegments` returns empty (Cube version mismatch), find-similar silently restricts to measures+dims; document the gap in a yellow note.
7. **Wire into YAML preview rail** — header chip reflects current `artifactKind`.
8. **Wire into identity step right rail / body** — small chip near the name field showing current authoring kind.
9. **Audit:** grep for places that surface entry names — any missed surface? Add the badge there too.
10. **Manual sanity:**
    - Author `mf_users.whales` segment → in measure-mode column picker, the existing `whales_count` (measure) and `whales` (segment) show with different badges → user can pick the right one unambiguously.
    - Find-similar warning highlights `whales_count` vs `whales` with their badges.

## Success Criteria

- [ ] `KindBadge` component tests green.
- [ ] All integration test surfaces show the right badge.
- [ ] Existing `find-similar-warning` test extended to assert kind badge is shown.
- [ ] Audit reveals no missed surface (or follow-up tickets filed for any deferred surface).
- [ ] Accessibility: each badge has `aria-label`.
- [ ] Manual: `whales` (segment) vs `whales_count` (measure) coexist visibly in any picker that lists both.
- [ ] No regression in measure-only mode flow.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Badge crowds short cube member names (`country`, `dau`) | Compact mode (icon-only, label hidden) for dense pickers; labeled mode for find-similar. Tooltip on hover always shows full label. |
| Segment data needs to surface for badges + find-similar | **Closed (red-team F-8):** add `useReachableSegments` as a SEPARATE hook. Do NOT extend `useReachableMembers` (segments aren't filterable columns). If Cube `/meta` lacks segments, hook returns `[]` and cross-kind find-similar degrades to within-kind only with a yellow note. |
| Two cubes have same-named entries of different kinds → confusing badge color but identical text | Out of scope for v1; cross-cube disambiguation lives in the parent cube prefix already (`cube_a.name` vs `cube_b.name`). |
| Color palette clashes with existing theme tokens | Pull colors from `theme/tokens.css`; use existing semantic tokens (`brand`, `success`, `info`). No raw hex codes. |
| Badge component bloat (style props, modes, sizes) | Cap at 50 lines + two modes (`compact`, `labeled`). If more needed, defer to a v2 follow-up. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `KindBadge renders measure/dim/segment correctly` | Component basics |
| `KindBadge has aria-label per kind` | Accessibility |
| `slot-picker shows badge per row` | Step 3 integration |
| `filter-leaf-row shows badge in column dropdown` | Step 4 / segment integration |
| `find-similar-warning shows kind` | Disambiguation in warnings |
| `yaml preview rail header shows kind chip` | Rail integration |
| `useReachableMembers includes segments` | Hook contract extension |
