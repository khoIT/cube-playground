---
phase: 2
title: "Stores & Utils"
status: pending
priority: P1
effort: "30 min"
dependencies: [1]
---

# Phase 2: Stores & Utils

## Context Links

- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Shell — sidebar utils"
- Hermes source: `apps/web/src/utils/sidebar-collapsed-store.ts`, `recent-items-store.ts`, `topbar-trailing-context.tsx`

## Overview

Port 4 utility modules that back the shell's stateful behaviors: sidebar collapse, section expand/collapse persistence, recent-items LRU, and topbar trailing slot context. All localStorage keys prefixed `gds-cube:*` (NOT `hermes:*`).

## Key Insights

- Hermes splits collapsed state and section state into two stores — keep that separation (different lifecycles + cross-tab event channels).
- Recent-items modules in Hermes: `chats | features | segments | campaigns | boards`. For cube: `chat | data-model | metrics-catalog | segments` (drop features/campaigns/boards — not in cube).
- TopbarTrailingContext exposes `{ node, setNode }` so any page can register an action node via `useTopbarTrailing()`.
- Section path map is the **only** cube-specific data — define explicitly in `sidebar-section-store.ts`.

## Requirements

### Functional
- `getCollapsed()` / `setCollapsed(v)` / `onCollapsedChange(handler)` survive page reload.
- `getSectionExpanded(id)` / `setSectionExpanded(id, v)` survive reload, broadcast via `gds-cube:sidebar-expand-changed` event.
- `getSidebarSectionForPath(pathname)` returns correct section id for cube routes.
- `getRecent(module)` / `pushRecent(module, item)` / `clearRecent(module)` LRU-8 per module.
- `<TopbarTrailingProvider>` + `useTopbarTrailing()` work across the App tree.

### Non-functional
- Pure utils, no React deps in store files (except `topbar-trailing-context`).
- All `localStorage` access wrapped in try/catch (no exceptions if storage unavailable).
- File size ≤ 80 lines each.

## Architecture

```
src/shell/sidebar/
  sidebar-collapsed-store.ts        ← port of hermes/utils/sidebar-collapsed-store.ts
  sidebar-section-store.ts          ← NEW (section expand + path-to-section map)
  recent-items-store.ts             ← port of hermes/utils/recent-items-store.ts

src/shell/topbar/
  topbar-trailing-context.tsx       ← port of hermes/utils/topbar-trailing-context.tsx
```

### `sidebar-section-store.ts` — path-to-section map (cube-specific)

```ts
const PATH_TO_SECTION: Array<{ prefix: string; sectionId: string }> = [
  { prefix: '/chat',              sectionId: 'chats' },
  { prefix: '/build',             sectionId: 'playground' },
  { prefix: '/catalog/data-model', sectionId: 'data-model' },
  { prefix: '/data-model/new',     sectionId: 'data-model' },
  { prefix: '/catalog/metrics',    sectionId: 'metrics-catalog' },
  { prefix: '/segments',           sectionId: 'segments' },
  { prefix: '/catalog/digest',         sectionId: 'advanced' },
  { prefix: '/catalog/notifications',  sectionId: 'advanced' },
  { prefix: '/catalog/saved-views',    sectionId: 'advanced' },
  { prefix: '/catalog/workspaces',     sectionId: 'advanced' },
  { prefix: '/segments/identity-map',  sectionId: 'advanced' },
];

export function getSidebarSectionForPath(pathname: string): string | null {
  // Longest-prefix match (so /segments/identity-map → 'advanced', not 'segments').
  let best: { prefix: string; sectionId: string } | null = null;
  for (const entry of PATH_TO_SECTION) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.sectionId ?? null;
}
```

## Related Code Files

### Create
- `src/shell/sidebar/sidebar-collapsed-store.ts`
- `src/shell/sidebar/sidebar-section-store.ts`
- `src/shell/sidebar/recent-items-store.ts`
- `src/shell/topbar/topbar-trailing-context.tsx`

### Modify
- None

### Delete
- None

## Implementation Steps

1. **Create `src/shell/sidebar/sidebar-collapsed-store.ts`** — port verbatim from Hermes. Rename:
   - `KEY = 'hermes:sidebar:collapsed'` → `KEY = 'gds-cube:sidebar:collapsed'`
   - `EVENT = 'hermes:sidebar:collapsed-changed'` → `EVENT = 'gds-cube:sidebar:collapsed-changed'`

2. **Create `src/shell/sidebar/sidebar-section-store.ts`** — new file:
   - `getSectionExpanded(id)`, `setSectionExpanded(id, v)` keyed `gds-cube:sidebar:section:{id}` (default `true`).
   - `getSidebarSectionForPath(pathname)` with longest-prefix match (see Architecture).
   - Event channel: `gds-cube:sidebar-expand-changed`.

3. **Create `src/shell/sidebar/recent-items-store.ts`** — port verbatim from `hermes/utils/recent-items-store.ts`. Changes:
   - Key prefix: `hermes.recent.v1.{module}` → `gds-cube.recent.v1.{module}`
   - `RecentModule` type: `'chat' | 'data-model' | 'metrics-catalog' | 'segments'`
   - `MAX = 8` unchanged
   - Add event dispatch on `pushRecent` / `clearRecent`: `window.dispatchEvent(new Event('gds-cube:recent-changed'))` (sidebar listens to refresh).

4. **Create `src/shell/topbar/topbar-trailing-context.tsx`** — port verbatim from `hermes/utils/topbar-trailing-context.tsx`. No changes needed (no localStorage, just React context).

5. **`npm run typecheck`** — must pass.

6. **Manual smoke** (browser console):
   ```js
   localStorage.setItem('gds-cube:sidebar:collapsed', '1');
   window.dispatchEvent(new CustomEvent('gds-cube:sidebar:collapsed-changed', { detail: true }));
   ```
   Confirm no errors.

## Todo List

- [ ] Create `sidebar-collapsed-store.ts` with `gds-cube:*` keys
- [ ] Create `sidebar-section-store.ts` with path map + longest-prefix matcher
- [ ] Create `recent-items-store.ts` with 4-module RecentModule type
- [ ] Create `topbar-trailing-context.tsx` (React context provider + hook)
- [ ] `npm run typecheck` passes

## Success Criteria

- [ ] All 4 utility modules importable from `src/shell/*`.
- [ ] `getSidebarSectionForPath('/segments/identity-map')` returns `'advanced'` (longest-prefix).
- [ ] `getSidebarSectionForPath('/segments')` returns `'segments'`.
- [ ] `getSidebarSectionForPath('/foo/bar')` returns `null`.
- [ ] `pushRecent('segments', {…})` then `getRecent('segments')` returns the item at index 0.
- [ ] Cross-tab: changing collapsed state in one tab triggers `onCollapsedChange` listener in another.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Localstorage key collision with Hermes if cube + Hermes run on same origin | Prefixed `gds-cube:*` per hard constraint |
| Path-to-section map drifts when routes change | Single file — keep it the only source of truth; reference in Phase 5 sidebar.tsx |
| Recent-items shape change breaks consumers | Hermes shape ported verbatim; cube consumers (Phase 5+) follow same shape |
| Event channel name collision | Distinct `gds-cube:*` event names per channel |

## Security Considerations

- LocalStorage only; no PII, no tokens. Recent items contain segment IDs (already exposed in URL).

## Next Steps

Phase 3 (sidebar primitives) imports from `sidebar-collapsed-store` and `sidebar-section-store`. Phase 4 (topbar primitives) imports `topbar-trailing-context`.
