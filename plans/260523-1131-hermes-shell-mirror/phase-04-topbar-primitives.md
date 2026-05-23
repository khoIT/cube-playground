---
phase: 4
title: "Topbar Primitives"
status: pending
priority: P1
effort: "60 min"
dependencies: [1, 2]
---

# Phase 4: Topbar Primitives

## Context Links

- Spec: [`phase-00-spec/pixel-spec.md`](./phase-00-spec/pixel-spec.md) § Topbar / Breadcrumb / SearchTrigger / AvatarMenu
- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Shell — topbar"
- Hermes source: `apps/web/src/components/topbar/{topbar,breadcrumb,search-trigger,avatar-menu}.tsx`

## Overview

Port 4 topbar components. `topbar.tsx`, `search-trigger.tsx` are 🟢 verbatim. `breadcrumb.tsx` is 🔴 rewritten with cube-specific path-to-label resolver (no Hermes data deps). `avatar-menu.tsx` is 🟡 wraps cube's existing user-menu inside Hermes' 32px brand circle trigger.

## Key Insights

- Hermes breadcrumb pulls names from `allFeatures` / `allSegments` / `allCampaigns` modules — none exist in cube. Resolver becomes a simple path-prefix → label map + dynamic segment-name from `segmentsClient` cache.
- SearchTrigger button opens cube's existing `SmartSearchProvider` overlay — wire via the provider's exposed `openOverlay()` or equivalent. Verify API in `src/shared/smart-search/smart-search-context.ts`.
- AvatarMenu adapts: keep Hermes' visual trigger (32px circle, `T.brand`, initials), put cube's existing `user-menu` content inside a popover.
- `TopbarTrailingContext` from Phase 2 lets pages register actions (used in Phase 7 for "+ New segment").

## Requirements

### Functional
- `Topbar` renders 56px sticky chrome with blur backdrop.
- `Breadcrumb` resolves cube routes to human-readable labels.
- `SearchTrigger` opens SmartSearch overlay on click + `⌘K` (existing cube shortcut keeps working).
- `AvatarMenu` opens user menu (existing cube `user-menu` content reused).
- `TopbarTrailingProvider` mounted at App level; pages can register trailing nodes.

### Non-functional
- All files ≤ 150 lines.
- Use `T` from `src/shell/theme`; no AntD.
- Breadcrumb resolver pure (no async data fetching in render).

## Architecture

```
src/shell/topbar/
  topbar.tsx                    (~50 lines)  ← 56px sticky, blur, layout
  breadcrumb.tsx                (~120 lines) ← cube path → label resolver + render
  search-trigger.tsx            (~50 lines)  ← input-styled button → openOverlay
  avatar-menu.tsx               (~90 lines)  ← cube user-menu wrapped in Hermes trigger
  topbar-trailing-context.tsx   (~40 lines)  ← (already in Phase 2)
```

### Cube breadcrumb resolver

```ts
// Static prefix → label map
const STATIC: Array<{ prefix: string; label: string; to?: string }> = [
  { prefix: '/build',                label: 'Playground' },
  { prefix: '/catalog/data-model',   label: 'Data Model' },
  { prefix: '/catalog/metrics',      label: 'Metrics Catalog' },
  { prefix: '/catalog/digest',       label: 'Digest' },
  { prefix: '/catalog/notifications', label: 'Notifications' },
  { prefix: '/catalog/saved-views',  label: 'Saved Views' },
  { prefix: '/catalog/workspaces',   label: 'Workspaces' },
  { prefix: '/segments/identity-map', label: 'Identity Map' },
  { prefix: '/segments',             label: 'Segments' },
  { prefix: '/chat',                 label: 'Chat' },
  { prefix: '/data-model/new',       label: 'New Data Model' },
];

// Dynamic resolvers for /segments/:id and /catalog/data-model/:cube etc:
//  - Read segment name from segmentsClient in-memory cache (Phase 7 keeps cache)
//  - Read cube name straight from URL param if cache miss (fallback)
```

## Related Code Files

### Create
- `src/shell/topbar/topbar.tsx`
- `src/shell/topbar/breadcrumb.tsx`
- `src/shell/topbar/search-trigger.tsx`
- `src/shell/topbar/avatar-menu.tsx`

### Modify
- None (TopbarTrailingProvider mount lives in Phase 6 App.tsx rewrite)

### Delete
- None

## Implementation Steps

1. **`topbar.tsx`** — 🟢 copy verbatim from `hermes/apps/web/src/components/topbar/topbar.tsx`. No edits — uses `TopbarTrailingContext` + 3 sibling components.

2. **`search-trigger.tsx`** — 🟢 copy verbatim. `onOpen` prop passed from `topbar.tsx`. Visual identical (input-styled button + `⌘K`/`Ctrl K` kbd hint).

3. **`breadcrumb.tsx`** — 🔴 rewrite resolver:
   - Drop all Hermes imports (`allFeatures`, `allSegments`, `allCampaigns`, `listThreads`, `listBoards`, `breadcrumb-resolver`).
   - Define local `resolveBreadcrumb(pathname)` returning `Array<{ label: string; to?: string }>`.
   - Static prefix matches from STATIC table (longest-prefix wins).
   - Dynamic segment: if `/segments/{id}`, read name from `segmentsClient` cache (or fall back to `id` if cache cold).
   - Dynamic data-model cube: if `/catalog/data-model/{name}`, label = `{name}` verbatim.
   - Render: NavLink (RR5, same API) for non-last crumbs, span with `aria-current=page` for last.
   - All styles from `pixel-spec.md` § Breadcrumb.

4. **`avatar-menu.tsx`** — 🟡:
   - Trigger button: 32×32 circle, `T.brand` bg, `#fff` initials from user name.
   - On click → open a popover containing cube's existing `user-menu` component (`src/components/Header/user-menu.tsx`).
   - Replace `useNavigate` → `useHistory` if any nav inside cube's user-menu.
   - Use existing cube user state — no new auth surface.

5. **`npm run typecheck`** passes.

6. **Smoke** — temporarily mount `<Topbar onSearchOpen={() => {}} />` inside `<TopbarTrailingProvider>` in App.tsx during dev → verify breadcrumb resolves, SearchTrigger click opens overlay, AvatarMenu opens menu.

## Todo List

- [ ] Create `topbar.tsx` (verbatim)
- [ ] Create `search-trigger.tsx` (verbatim)
- [ ] Create `breadcrumb.tsx` (cube resolver, RR5 NavLink)
- [ ] Create `avatar-menu.tsx` (cube user-menu wrapped in Hermes trigger)
- [ ] Verify SmartSearchProvider exposes `openOverlay()` (or document fallback)
- [ ] `npm run typecheck` passes
- [ ] Smoke render in dev

## Success Criteria

- [ ] `Topbar` height 56, padding `0 24px`, gap 16, blur backdrop, sticky.
- [ ] `Breadcrumb` shows "Playground" at `/build`; "Segments / High-LTV whales" at `/segments/s_001`.
- [ ] `SearchTrigger` click opens CmdK modal (same as existing `⌘K`).
- [ ] `AvatarMenu` click opens cube user menu; close on outside click.
- [ ] No console errors on any route.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| SmartSearchProvider doesn't expose `openOverlay()` | Read `src/shared/smart-search/smart-search-context.ts` first; if private, wire via context consumer + setter |
| Cube user-menu uses different prop shape than Hermes' AvatarMenu expects | Wrap as plain JSX inside the popover body — no prop translation needed |
| Breadcrumb cache miss on `/segments/:id` direct-link | Fallback to id-as-label; Phase 7 ensures segmentsClient hydrates on library mount |
| Dark-mode topbar blur backdrop washes out | `T.topbar` already includes alpha; works in both modes per Hermes verified |

## Security Considerations

- AvatarMenu reuses cube's user-menu — no new auth path.
- SearchTrigger opens existing SmartSearch — no new search scope.

## Next Steps

Phase 5 assembles sidebar.tsx + custom data-model section. Phase 6 mounts `<TopbarTrailingProvider>` + `<Topbar>` in App.tsx and moves GamePicker into trailing slot.
