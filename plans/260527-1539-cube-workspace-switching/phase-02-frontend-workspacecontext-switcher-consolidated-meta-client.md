---
phase: 2
title: "Frontend WorkspaceContext + switcher + consolidated meta client"
status: partial
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 2: Frontend WorkspaceContext + switcher + consolidated meta client

## Overview
Add a workspace concept to the frontend: a persisted active workspace, a header switcher,
and a single workspace-aware meta client that replaces the three duplicated meta loaders.
All Cube fetches send the `x-cube-workspace` header.

## Requirements
- Functional: user picks workspace in header; selection persisted; whole app's meta/load
  calls carry the active workspace; prod renders its 79 entries.
- Non-functional: DRY — collapse 3 loaders into one; align with the
  `260527-1306-glossary-resolver-consolidation` plan to avoid a second consolidation.

## Architecture
- **WorkspaceContext** (`src/components/workspace-context.tsx`): `{ workspace, workspaces,
  setWorkspace }`. Hydrate `workspaces` from `GET /api/workspaces`; active id persisted in
  localStorage (`gds-cube:workspace`, default `local`). Thread `workspace` into
  `AppContext.playgroundContext` so existing `useAppContext()` consumers can read it.
- **Consolidated meta client** (`src/api/cube-meta-client.ts`): one function
  `fetchMeta({ apiUrl, token, workspaceId, gameId? })` → `Meta`. Sends `x-cube-workspace`.
  Replaces fetch bodies in:
  - `QueryBuilderV2/hooks/query-builder.ts:361`
  - `pages/Catalog/use-catalog-meta.ts:70`
  - `QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts:60`
  Keep each hook's state/caching; only the fetch+parse is centralized.
- **Switcher UI**: new pill in topbar cluster (`src/shell/topbar/topbar.tsx:50`), left of
  GamePicker. antd `Dropdown` of `workspaces` (label), matches design tokens
  (`var(--text-primary)`, `var(--border-card)`, `var(--radius-md)`). Reuse GamePicker chip
  styling for visual consistency (per design-guidelines).
- **API client header**: `src/api/api-client.ts` + `src/hooks/cubejs-api.ts` attach
  `x-cube-workspace` on every request (cube SDK `headers` option / fetch wrapper).
- On workspace change: trigger `refreshMeta()` + clear in-memory meta so surfaces re-fetch.

## Related Code Files
- Create: `src/components/workspace-context.tsx`, `src/api/cube-meta-client.ts`,
  `src/shell/topbar/workspace-switcher.tsx`
- Modify: `src/components/AppContext.tsx` (PlaygroundContext + `workspace` field),
  `src/App.tsx` (mount WorkspaceProvider + bootstrap), `src/shell/topbar/topbar.tsx`
- Modify: `src/api/api-client.ts`, `src/hooks/cubejs-api.ts` (workspace header)
- Modify: 3 meta loaders above to call `cube-meta-client.ts`

## Implementation Steps
1. Build `cube-meta-client.ts`; migrate the 3 loaders to it (verify each surface still loads on `local`).
2. Add WorkspaceContext + provider; hydrate from `/api/workspaces`; persist active id.
3. Attach `x-cube-workspace` header in api-client + cube SDK factory.
4. Add workspace switcher pill in topbar; wire to context.
5. On change → reset meta + `refreshMeta()`; confirm Catalog/Playground/Data Model repaint.
6. Switch to `prod` → confirm 79 entries render; switch back → local intact.

## Success Criteria
- [ ] Header switcher lists workspaces from server; selection persists across reload.
- [ ] Every Cube request carries `x-cube-workspace`.
- [ ] One meta client; the 3 old fetch bodies removed (grep shows single source).
- [ ] Prod workspace renders 79 entries in Catalog + Data Model; local unchanged.
- [ ] Switcher visually matches GamePicker (tokens, radius, spacing) per design-guidelines.

## Risk Assessment
- **Consolidation collision** with glossary-resolver-consolidation plan → coordinate the
  shared meta-client shape before writing (check that plan's target module).
- **Missing `.meta` on prod** — Catalog enrichment must null-guard (handled fully in Phase 3/5).
- **SDK header support** — if `@cubejs-client/core` won't forward custom headers cleanly,
  fall back to a fetch wrapper for meta requests.
