---
phase: 2
title: "Wizard Scaffolding + State"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: Wizard Scaffolding + State

## Context Links

- Brainstorm: [`plans/reports/brainstorm-260516-1526-define-metric-wizard.md`](../reports/brainstorm-260516-1526-define-metric-wizard.md) §Frontend pieces, §Wizard state shape.
- Header: `src/components/Header/Header.tsx`.
- Dialog usage examples: search `@cube-dev/ui-kit` Dialog imports in `src/QueryBuilderV2/`.

## Overview

Add the **✱ New metric** header CTA, fullscreen wizard `Dialog`, and the typed state hook that all five sections will consume. No business logic yet — just the shell, types, and the empty section components wired to a single source of truth.

## Key Insights

- One state hook (`useNewMetricDraft`) is the single source of truth. Sections are dumb subscribers.
- Each section file stays focused (well under 200 lines) — `FilterSection` reuses the existing `FilterMember` to avoid re-implementing operator UI.
- The header has no "API Settings" button today; CTA sits to the right of the `Spacer` until that lands.

## Requirements

**Functional**
- New CTA: `✱ New metric`, rendered at right edge of `Header` on desktop; hidden on mobile in v1.
- Click opens `NewMetricDialog` as a fullscreen overlay; `Escape` closes; outside click does NOT close (data-loss guard).
- Wizard layout: left = 5 stacked sections; right = preview pane placeholder (filled by Phase 4).
- Footer actions: `Cancel`, `Validate` (disabled stub), `Define` (disabled stub).
- State hook exposes `{ draft, setField, reset, isValid, validation }`.
- Validation surface: required fields per section + snake_case rule for `name` + uniqueness placeholder (real check arrives in Phase 3).

**Non-functional**
- Strict TypeScript; no `any` in public hook signatures.
- All new files ≤ 200 lines.

## Architecture

```
NewMetricButton ─┐
                 ▼
        NewMetricDialog (fullscreen)
        ├── sections/
        │   ├── SourceSection
        │   ├── OperationSection
        │   ├── OfSection           (stub: just source-cube members)
        │   ├── FilterSection       (reuses FilterMember)
        │   └── IdentitySection
        ├── preview/
        │   ├── YamlPreview         (placeholder string)
        │   └── DryRunSqlPreview    (placeholder)
        └── hooks/useNewMetricDraft
```

All cross-cutting state via `useNewMetricDraft`. No section reads `meta` directly except Source/Of (Of becomes real in Phase 3).

## Related Code Files

**Create**
- `src/QueryBuilderV2/NewMetric/index.ts` — barrel.
- `src/QueryBuilderV2/NewMetric/types.ts` — `NewMetricDraft` (per brainstorm), `Operation` union, `Format` union, validation result shape.
- `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx` — CTA.
- `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` — dialog shell + layout.
- `src/QueryBuilderV2/NewMetric/sections/source-section.tsx` — cube picker (uses existing meta context).
- `src/QueryBuilderV2/NewMetric/sections/operation-section.tsx` — radio group of 7 ops.
- `src/QueryBuilderV2/NewMetric/sections/of-section.tsx` — member picker (stub: only same-cube members in this phase).
- `src/QueryBuilderV2/NewMetric/sections/filter-section.tsx` — single optional `FilterMember` row.
- `src/QueryBuilderV2/NewMetric/sections/identity-section.tsx` — name/title/description/format.
- `src/QueryBuilderV2/NewMetric/preview/yaml-preview.tsx` — placeholder using `PrismCode`.
- `src/QueryBuilderV2/NewMetric/preview/dry-run-sql-preview.tsx` — placeholder.
- `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` — state + field setter + validation.
- `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-draft.test.ts` — reducer tests.

**Modify**
- `src/components/Header/Header.tsx` — insert `<NewMetricButton />` after `<Spacer />` on desktop.
- `src/components/AppContext.tsx` (or whichever module owns `PlaygroundContext`) — expose `refreshMeta()` so consumers outside the QueryBuilder tree can trigger a re-fetch. Implementation choice: lift the `loadMeta` logic out of `useQueryBuilder` into a context-owned function; `useQueryBuilder` then subscribes to it. **(Validation Session 1, decision 1.)**
- `src/QueryBuilderV2/hooks/query-builder.ts` — replace the local `loadMeta` with a subscriber to `AppContext.refreshMeta`. Maintain backwards-compatible exported name where consumed.

## Implementation Steps

1. Define `types.ts`:
   - `NewMetricDraft` per brainstorm; explicit `null`s for unset.
   - `Operation = 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max' | 'ratio'`.
   - `ValidationResult = { isValid: boolean; errors: Partial<Record<keyof NewMetricDraft, string>> }`.
2. Implement `use-new-metric-draft.ts`:
   - `useReducer` (action `setField`, `reset`).
   - Pure `validate(draft)` collocated in the same file; rules: source required, operation required, ofMember required (ofMemberB iff `ratio`), name matches `/^[a-z][a-z0-9_]*$/` for default snake_case, title required.
   - Export both the hook and `validate` (testable in isolation).
3. `NewMetricButton.tsx`:
   - `@cube-dev/ui-kit` `Button` with `Sparkles` (lucide) icon prefix, label "New metric", `qa="NewMetricCTA"`.
   - Toggles `open` state local to the button; renders `NewMetricDialog` when open.
4. `NewMetricDialog.tsx`:
   - Fullscreen via the kit's `Dialog`/`Modal` (whichever supports fullscreen — pick the one already used elsewhere in `QueryBuilderV2`).
   - Two-column flex: left scrollable sections list, right sticky preview pane (placeholder Phase 4).
   - Sticky footer: `Cancel | Validate (disabled) | Define (disabled)`.
   - Wires draft + setField to children via `props` (no extra context; one layer deep).
5. Implement each section as a thin controlled component reading `draft[field]` and calling `setField(field, value)`.
6. `FilterSection` reuses `FilterMember` — pass the source cube's dimensions/measures as the available pool; emit a single filter object into `draft.filter`.
7. Hook `NewMetricButton` into `Header.tsx` after the `Spacer`, gated to desktop (`isDesktopOrLaptop`).
8. Write the reducer test: covers `setField` for each key, validation for each invalid path.
9. `npm run typecheck` and `npm run test`.

## Todo List

- [ ] Add `types.ts`
- [ ] Implement `use-new-metric-draft` + reducer test
- [ ] Build `NewMetricDialog` shell + section stubs
- [ ] Build `NewMetricButton` and wire into `Header`
- [ ] Lift `loadMeta` into `AppContext` and expose `refreshMeta()`
- [ ] Verify dialog opens, closes via Esc, retains state until reset
- [ ] `npm run typecheck` + `npm run test` pass

<!-- Updated: Validation Session 1 - AppContext refreshMeta added to support Phase 4 success flow -->


## Success Criteria

- [ ] CTA appears in the desktop header and opens the wizard.
- [ ] Each section reads from and writes to a single draft state object.
- [ ] `validate(draft)` returns precise per-field errors for empty/invalid inputs.
- [ ] Test for reducer + validate covers ≥ 90% branches.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `Dialog` component variant mismatch with rest of app | Pick whichever variant is already used in `QueryBuilderV2`; do not introduce a new modal flavor. |
| State sprawl into context API | Keep state local to the dialog; lift only if Phase 3/4 demand it. |
| CTA confused with `+ Add measure` style controls in the query builder | Use `Sparkles` icon and "New metric" label; `qa` attribute differentiates for tests. |

## Security Considerations

- No new network calls in this phase.
- Free-text `description` rendered only inside the YAML preview (text) — no HTML sinks.

## Next Steps

- Phase 3 replaces the Of stub with a meta-driven reachable-members list.
