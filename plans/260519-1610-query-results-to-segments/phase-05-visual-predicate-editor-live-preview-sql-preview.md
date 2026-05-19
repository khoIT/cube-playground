---
phase: 5
title: "Visual predicate editor + live preview + SQL preview"
status: pending
priority: P1
effort: "1w"
dependencies: [0, 1]
---

# Phase 5: Visual predicate editor + live preview + SQL preview

## Overview

Add the segment editor route — a visual AND/OR tree builder with type-aware leaf operators, a debounced live cohort preview, generated SQL, and a Cube browser rail. Editor is reachable from `New segment` (Library) and `Edit predicate` (Detail).

## Requirements

**Functional**
- Route `/segments/:id/edit` and `/segments/new`.
- Editor surfaces:
  - Breadcrumb (`Segments / <name> / Edit predicate` or `Segments / New`).
  - Identity card: Name + Description fields.
  - **Visual predicate builder**:
    - Root group is always AND or OR; togglable.
    - `Add condition` adds a leaf; `Add group` adds nested AND/OR group.
    - Each leaf renders: cube.column dropdown (grouped by cube), operator dropdown (filtered by column type), value input (typed).
    - Remove buttons per leaf + per nested group.
    - Drag-to-reorder is **out of scope** for v1.
  - Static / Live toggle. Live exposes refresh interval picker (`5m / 15m / 1h / 6h / 24h`).
  - `Paste from query` button: pulls active Playground `Query.filters` into the tree.
  - Right rail (sticky):
    - Resolved cohort count + sparkline (last 14 estimates cached locally).
    - Generated SQL block (pre-formatted).
    - Cube browser: collapsible list of cubes + members; click to insert into current leaf.
  - Footer: `Cancel` / `Preview SQL` / `Save segment`.
- Backend `POST /api/preview`:
  - Body: `{ predicate_tree, primary_cube, identity_dim }`.
  - Translates tree to Cube `Query`, augments with `measures: ['<primary>.count']`.
  - Calls Cube `/load` and `/sql` in parallel.
  - Returns `{ estimated_count, cube_query, sql_preview, took_ms }`.
- Debounce live preview at 500ms; cancel in-flight on new keystroke.
- Save POSTs / PATCHes `/api/segments` with both tree + cached `cube_query_json` + new `predicate_meta_version`.

**Non-functional**
- Editor renders without firing `/api/preview` until the predicate is structurally valid (no empty leaves).
- AbortController cancels stale preview requests.
- Tree state lives in a single zustand store or `useReducer`; no prop drilling.
- **Predicate tree visuals, leaf rows, group bars, member pills, and the right-rail cards reuse P0 visual primitives.** Sparkline in resolved-cohort card uses P0 `Sparkline`.

**Visual parity**
- Editor screen matches `~/Downloads/cube-segment/screen-editor.jsx` within ≤2% pixel delta at both viewports.
- Predicate tree groups, leaf rows, AND/OR pills, add-condition buttons, refresh-behaviour card, resolved-cohort card, SQL preview, and Cube browser rail all match the mock.

## Architecture

```
src/pages/Segments/editor/
  editor-view.tsx                 (top-level orchestrator, route wired)
  identity-card.tsx
  refresh-behaviour-card.tsx
  predicate-builder/
    predicate-group.tsx           (AND/OR group + children renderer)
    predicate-leaf.tsx            (column + op + value row)
    operators.ts                  (op set per type)
    value-input.tsx               (renders correct input per type)
  right-rail/
    resolved-cohort-card.tsx
    sql-preview-card.tsx
    cube-browser-card.tsx
  hooks/
    use-predicate-state.ts        (tree + update/remove/add helpers)
    use-preview.ts                (debounced /api/preview client)
    use-paste-from-query.ts       (lifts current Playground Query.filters into tree)
  utils/
    cube-query-filter-to-tree.ts  (FE mirror of P1 translator for paste-from-query)

server/src/routes/preview.ts      (NEW endpoint)
server/src/services/preview-service.ts
```

`use-predicate-state.ts` exposes `updateNode(path, fn)`, `removeNode(path)`, `addLeaf(path)`, `addGroup(path)`, `toggleConj(path)` — mirrors mock's `screen-editor.jsx` helpers.

## Related Code Files

**Create**
- `src/pages/Segments/editor/**` (per architecture above)
- `server/src/routes/preview.ts`
- `server/src/services/preview-service.ts`
- `server/test/preview.test.ts`

**Modify**
- `src/index.tsx` — add routes `/segments/new` + `/segments/:id/edit`
- `src/pages/Segments/library/library-toolbar.tsx` — `New segment` button navigates to `/segments/new`
- `src/pages/Segments/detail/detail-header-actions.tsx` — `Edit predicate` button navigates to `/segments/:id/edit`
- `src/api/segments-client.ts` — add `preview()`

## Implementation Steps

1. Implement `operators.ts`:
   - Export `OP_BY_TYPE: Record<'string'|'number'|'time'|'boolean', { id, label }[]>` matching mock's `OPERATORS` map.
2. Implement `value-input.tsx` — renders `<input>` / `<select>` / multi-select / date picker / boolean toggle based on `(type, op)`.
3. Implement `use-predicate-state.ts`:
   - State shape = `PredicateNode` (root group).
   - Helpers mirror mock; immutable updates via `structuredClone`.
   - Validation: `isValid(tree)` returns true if every leaf has non-empty value (or op is `set`/`notSet`).
4. Implement `predicate-group.tsx` + `predicate-leaf.tsx` — render-only; receive state + dispatcher props.
5. Implement `editor-view.tsx`:
   - Loads existing segment if `:id`, else seeds an empty AND group.
   - Provides state + dispatcher to the builder.
6. Implement `identity-card.tsx` + `refresh-behaviour-card.tsx` (Static/Live toggle + interval picker).
7. Implement server `preview-service.ts` + `routes/preview.ts`:
   - Validates body with zod.
   - Translates tree to filters.
   - Builds Cube query `{ measures: ['<primary>.count'], filters, limit: 1 }`.
   - Calls Cube `/load` + `/sql` in parallel via existing `cube-client`.
   - Returns count from result data row, generated SQL from `/sql` response.
   - Cache key: `hash(predicate_tree + primary_cube + meta_version)`; cache 60s per process.
8. Implement `use-preview.ts`:
   - 500ms debounce; AbortController; surfaces `{ count, sql, isLoading, error }`.
   - Local 14-entry ring buffer for sparkline.
9. Implement right-rail cards:
   - `resolved-cohort-card.tsx`: number + sparkline + last-updated.
   - `sql-preview-card.tsx`: pre-formatted SQL with copy button.
   - `cube-browser-card.tsx`: collapsible cube list from `/meta`; click member calls a callback to insert into current leaf.
10. Implement `use-paste-from-query.ts`:
    - Reads current Playground Cube `Query.filters` from query-builder context (or URL param if Playground not mounted).
    - Uses `cube-query-filter-to-tree.ts` (FE mirror of P1 translator) to produce a tree; merges into editor state.
11. Implement Save:
    - Calls `segmentsClient.create/update` with `predicate_tree_json` (server translates + caches `cube_query_json`).
    - Navigates back to Detail on success.
12. Wire routes and entry points (`New segment`, `Edit predicate` buttons).
13. Add tests:
    - `use-predicate-state.test.ts` — add/remove/toggle paths.
    - `preview.test.ts` — server endpoint contract.
    - `cube-query-filter-to-tree.test.ts` — FE translator parity with server.

## Success Criteria

- [ ] `/segments/new` opens editor with empty AND group.
- [ ] Adding 2 conditions and toggling AND→OR updates the live cohort count within 1.5s.
- [ ] SQL preview renders the generated SQL string from Cube `/sql`.
- [ ] Cube browser shows all cubes + dims; clicking a member inserts it into the focused leaf.
- [ ] `Paste from query` pulls Playground filters into the tree (verified against a known query).
- [ ] Save round-trips: tree + cube_query_json + meta_version land in DB.
- [ ] Stale preview requests are aborted on rapid edits (verified via network panel).
- [ ] `/api/preview` caches identical bodies within 60s.
- [ ] Playwright visual diff passes ≤2% for `editor` screen at both viewports.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Live preview hammers Cube during burst typing | 500ms debounce + AbortController + server-side 60s cache. |
| Tree → Cube filter translator misses some FE-only operator forms (e.g. multi-value `IN`) | Strict zod validation at editor save boundary; UI disables save when tree invalid. |
| `Paste from query` only sees Playground filters if route is mounted | Read from URL param `?query=` as fallback; KeepAliveRoute preserves Playground state when user toggles tabs. |
| Cube browser rail explodes with 50+ cubes / 1000+ members | Virtualize the list; default-collapse non-`mf_users-hub` reachable cubes. |
| Mock editor used `mf_users.` prefix in column dropdown — real impl uses full qualified name | Use qualified names everywhere; display short name as label, store full id. |
