---
phase: 6
title: "App Shell & Routes"
status: pending
priority: P1
effort: "45 min"
dependencies: [4, 5]
---

# Phase 6: App Shell & Routes

## Context Links

- Brainstorm § 4.1 (new shell layout), § 4.4 (route changes), § 4.5 (provider stack)
- Spec: [`phase-00-spec/pixel-spec.md`](./phase-00-spec/pixel-spec.md) § "Outer shell"
- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Shell — chrome glue", "Header deletion"

## Overview

Rewrite `App.tsx` outer layout to Hermes shell. Update `index.tsx` routes (`/` → `/build` redirect, add `/chat`, redirect `/catalog` exact → `/catalog/data-model`). Create chat placeholder. Move `GamePicker` to topbar trailing slot. Delete `src/components/Header/` directory (except files relocated). Vendor `design-reference/` tree from Hermes.

## Key Insights

- App.tsx is the only file that imports `<Header>`; safe to delete the dir once App is rewritten.
- `GamePicker` mounts via `useTopbarTrailing()` from anywhere — move file, wire in App.tsx so it's always rendered (not page-specific).
- Cube uses `react-router-dom@5` with `withRouter(App)` HOC + `createHashHistory`. Keep that. RR5 `Redirect` component for `/` → `/build`.
- `KeepAliveRoute` pattern preserved; only Index route changes.
- `IndexPage` becomes orphaned — delete `src/pages/Index/`.
- `design-reference/` from Hermes vendored at repo root, excluded from build via `tsconfig.json` + `.gitignore` (or commit if user wants traceability).

## Requirements

### Functional
- `/` redirects to `/build` (Playground).
- `/chat` renders placeholder empty-state page.
- `/catalog` (exact) redirects to `/catalog/data-model`.
- All other existing routes unchanged + render inside new shell.
- `<Sidebar/>` + `<Topbar/>` + scrollable main panel visible on every route.
- `<GamePicker/>` visible in topbar trailing slot.
- Cube's existing controls (SmartSearch, theme toggle, lang toggle, help, notif bell, API Settings button) preserved — moved into topbar right cluster.
- Dark mode toggle still works (via cube `ThemeContext`).
- SmartSearch `⌘K` still works.
- Game switching unchanged.

### Non-functional
- `App.tsx` ≤ 180 lines.
- No more `<Layout>` / `<Layout.Content>` from AntD around the shell.
- Cube's `<Root>` from `@cube-dev/ui-kit` stays (provides styled-components theme).

## Architecture

### New provider stack (from outside in)

```
<Router history={hashHistory}>
  <AppContextProvider>
    <GameContextProvider>
      <ThemeProvider>
        <SecurityContextProvider>
          <App>                              ← rewritten outer layout
            <SmartSearchProvider>
              <TopbarTrailingProvider>       ← NEW (Phase 2)
                <CubeTokenBootstrap />
                <Routes ...>                 ← keep RR5 Switch + KeepAliveRoute pattern
```

### App.tsx outer layout (Hermes parity)

```tsx
<Root publicUrl="." styles={ROOT_STYLES}>
  <GlobalStyles />
  <SmartSearchProvider>
    <TopbarTrailingProvider>
      <CubeTokenBootstrap />
      <div style={{
        height: '100vh', overflow: 'hidden',
        background: T.shell,
        display: 'flex', flexDirection: 'row', alignItems: 'stretch',
        padding: 10, gap: 8, boxSizing: 'border-box',
      }}>
        <Sidebar />
        <main style={{
          flex: 1, minWidth: 0, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          background: T.surface, borderRadius: 18, overflow: 'hidden',
        }}>
          <Topbar onSearchOpen={() => /* open SmartSearch */} />
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
            {fatalError ? <Alert ... /> : children}
          </div>
        </main>
      </div>
      <SmartSearchOverlay />
      <GamePickerMount />              {/* uses useTopbarTrailing on mount */}
    </TopbarTrailingProvider>
  </SmartSearchProvider>
</Root>
```

### GamePicker mount

```tsx
// Tiny component that registers GamePicker as topbar trailing node
function GamePickerMount() {
  const { setNode } = useTopbarTrailing();
  useEffect(() => {
    setNode(<GamePicker />);
    return () => setNode(null);
  }, [setNode]);
  return null;
}
```

### Recent-items pusher hook (cube data-model + segment visits)

Add a small route-listener hook in App.tsx:

```tsx
function useRecentItemPusher() {
  const location = useLocation();
  useEffect(() => {
    const dm = location.pathname.match(/^\/catalog\/data-model\/([^/]+)/);
    if (dm) pushRecent('data-model', { id: dm[1], title: dm[1], updatedAt: new Date().toISOString() });
    const seg = location.pathname.match(/^\/segments\/([^/]+)/);
    if (seg && seg[1] !== 'identity-map' && seg[1] !== 'new') {
      // Title resolved lazily; if cache miss, use id as title until segment loads
      const cached = segmentsClient.getCachedName?.(seg[1]) ?? seg[1];
      pushRecent('segments', { id: seg[1], title: cached, updatedAt: new Date().toISOString() });
    }
    const met = location.pathname.match(/^\/catalog\/concept\/measure\/([^/]+)/);
    if (met) pushRecent('metrics-catalog', { id: met[1], title: met[1], updatedAt: new Date().toISOString() });
  }, [location.pathname]);
}
```

## Related Code Files

### Create
- `src/pages/ChatPlaceholder/chat-placeholder-page.tsx`

### Modify
- `src/App.tsx` — rewrite outer layout
- `src/index.tsx` — route changes
- `tsconfig.json` — exclude `design-reference/**`
- `vite.config.ts` — ensure `design-reference/` not bundled
- `.gitignore` (optional) — or commit `design-reference/`

### Move (file move, content unchanged)
- `src/components/Header/game-picker.tsx` → `src/shell/topbar/game-picker.tsx`
- `src/components/Header/use-game-context.ts` → `src/shell/topbar/use-game-context.ts` (or keep current path; update imports)

### Delete (after move)
- `src/components/Header/Header.tsx`
- `src/components/Header/brand-block.tsx`
- `src/components/Header/nav-pill.tsx`
- `src/components/Header/right-cluster.tsx`
- `src/components/Header/help-button.tsx` — relocate inside avatar-menu or skip
- `src/components/Header/language-toggle.tsx` — relocate or skip (lang toggle already in dropdown)
- `src/components/Header/notification-bell.tsx` — relocate inside avatar-menu trailing or skip
- `src/components/Header/search-box.tsx` — replaced by `SearchTrigger`
- `src/components/Header/theme-toggle.tsx` — relocated into BottomRow (Phase 3)
- `src/components/Header/user-menu.tsx` — used by `avatar-menu.tsx` (keep, re-import)
- `src/pages/Index/` — delete dir (no longer routed)
- `src/components/Header/__tests__/` — delete or migrate to shell tests

### Vendor
- Copy `hermes/design-reference/` → `cube-playground/design-reference/` (full tree)

## Implementation Steps

1. **Add chat placeholder page** `src/pages/ChatPlaceholder/chat-placeholder-page.tsx`:
   ```tsx
   import { MessageSquare } from 'lucide-react';
   import { Link } from 'react-router-dom';
   import { T } from '../../shell/theme';

   export function ChatPlaceholderPage() {
     return (
       <div style={{ padding: 32 }}>
         <div style={{
           maxWidth: 480, margin: '80px auto',
           background: T.surface, border: `1px solid ${T.n200}`, borderRadius: 12,
           padding: 48, textAlign: 'center',
         }}>
           <MessageSquare size={48} color={T.n400} style={{ margin: '0 auto 16px' }} />
           <h1 style={{ fontFamily: T.fDisp, fontSize: 32, fontWeight: 400, color: T.n950, letterSpacing: '0.005em', textTransform: 'uppercase' }}>Chat coming soon</h1>
           <p style={{ fontFamily: T.fSans, fontSize: 13, color: T.n500, margin: '8px 0 24px' }}>
             Conversational analytics will appear here.
           </p>
           <Link to="/build" style={{
             display: 'inline-flex', alignItems: 'center', gap: 6,
             padding: '0 14px', height: 34, borderRadius: 8,
             background: T.brand, color: '#fff', textDecoration: 'none',
             fontFamily: T.fSans, fontWeight: 500, fontSize: 13,
           }}>Go to Playground</Link>
         </div>
       </div>
     );
   }
   ```

2. **Rewrite `src/App.tsx`** — replace the body of the `render()` method (lines 127-173 currently) with the Hermes outer layout (see Architecture). Keep:
   - Class component shape + lifecycle (no refactor).
   - `ContextSetter` + `AppContextConsumer` pre-mount logic.
   - `<Root>` + `<GlobalStyles>` + `<SmartSearchProvider>` + `<CubeTokenBootstrap>` + `<SmartSearchOverlay>`.
   - Error boundary path.
   - Drop: `<Header selectedKeys={…}/>`, `<StyledLayoutContent>`, `withRouter` HOC stays.
   - Add: `<TopbarTrailingProvider>` wrap, `<Sidebar/>`, `<main><Topbar/>{children}</main>`, `<GamePickerMount/>`, `useRecentItemPusher()` call.
   - Wire `Topbar onSearchOpen={…}` to existing `useSmartSearch()` open API.

3. **Edit `src/index.tsx`** routes block:
   ```diff
   - <Route key="index" exact path="/" component={IndexPage} />
   + <Route key="index" exact path="/"><Redirect to="/build" /></Route>
   + <Route key="chat" exact path="/chat" component={ChatPlaceholderPage} />
   + <Route key="catalog-default" exact path="/catalog">
   +   <Redirect to="/catalog/data-model" />
   + </Route>
   ```
   Drop `IndexPage` import.

4. **Move GamePicker**:
   - `git mv src/components/Header/game-picker.tsx src/shell/topbar/game-picker.tsx`
   - Update imports in any file that references it (`src/App.tsx`).

5. **Delete Header dir** (except `user-menu.tsx` which `avatar-menu.tsx` consumes):
   - Verify no other consumers via `grep -r "components/Header"` — should be empty after step 4.
   - `rm -rf src/components/Header/{Header,brand-block,nav-pill,right-cluster,help-button,language-toggle,notification-bell,search-box,theme-toggle}.tsx`
   - Keep `user-menu.tsx` until Phase 4 confirms `avatar-menu.tsx` wraps it.
   - Delete `src/pages/Index/` directory.

6. **Vendor design-reference**:
   ```bash
   cp -r /Users/lap16299/Documents/code/hermes/design-reference ./design-reference
   ```
   Edit `tsconfig.json`: add `"design-reference"` to `exclude`.
   Edit `vite.config.ts`: ensure `build.rollupOptions.external` does NOT include it (it's outside `src/`, won't be bundled anyway).

7. **`npm run typecheck`** must pass.

8. **`npm run dev`** — verify:
   - `/` redirects to `/build` (Playground renders inside new shell)
   - `/chat` shows placeholder
   - `/catalog` redirects to `/catalog/data-model`
   - All existing routes still render
   - GamePicker visible in topbar
   - SmartSearch ⌘K opens
   - Dark mode toggle works
   - Click each sidebar tab → correct page loads

9. **`npm run test`** — all existing vitest specs pass (no regression).

## Todo List

- [ ] Create `chat-placeholder-page.tsx`
- [ ] Rewrite `App.tsx` outer layout
- [ ] Edit `index.tsx` routes: / redirect, /chat, /catalog redirect
- [ ] Move `game-picker.tsx` to `src/shell/topbar/`
- [ ] Delete `src/components/Header/` (except user-menu.tsx)
- [ ] Delete `src/pages/Index/`
- [ ] Vendor `design-reference/` from hermes
- [ ] `tsconfig.json` excludes `design-reference/`
- [ ] `npm run typecheck` passes
- [ ] `npm run dev` smoke on every route
- [ ] `npm run test` passes (no regressions)

## Success Criteria

- [ ] Navigate to `/` → lands on `/build`.
- [ ] Navigate to `/chat` → shows placeholder card.
- [ ] Every cube route renders inside the new shell.
- [ ] GamePicker visible in topbar; switching game still works.
- [ ] No console errors.
- [ ] Existing test suite green.
- [ ] No file references in `src/components/Header/*` outside `user-menu.tsx`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| SmartSearch open API differs from Hermes' onSearchOpen prop | Read `src/shared/smart-search/smart-search-context.ts` first; adapt callback |
| AntD modal/dropdown portals leak through new shell | Portals mount to `document.body` — unaffected by shell. Verify SegmentDetail's ActivateModal renders correctly |
| Removing IndexPage breaks any test or deep link | grep for `IndexPage` first; cube users hit `/build` directly per request |
| Move + delete in one step risks losing files mid-PR | Use `git mv` (or VSCode rename) so git tracks the move |
| Header dir contains tests | `__tests__` subdirs: delete with the Header dir |

## Security Considerations

- API Settings modal trigger relocated to BottomRow (Phase 3); still gated by existing `SecurityContextProvider`.
- Token storage (`gds-cube:token`) untouched.

## Status as of 2026-05-23

✅ DONE. App shell + routes fully rewritten:
- `src/App.tsx` rewritten: Hermes outer flex layout (shell padding 10, gap 8, rounded main, Sidebar + Topbar with TopbarTrailingProvider).
- `src/index.tsx` routes updated: `/` → `/build` redirect, `/chat` → ChatPlaceholderPage, `/catalog` (exact) → `/catalog/data-model` redirect.
- `src/pages/ChatPlaceholder/chat-placeholder-page.tsx` created: empty-state placeholder with link to Playground.
- GamePicker moved to topbar trailing via `useTopbarTrailing()` hook (no race condition after post-review fix).
- Route-listener hook added to push data-model / segment / metrics visits to recent-items-store.

**Post-review fixes applied:**
- CRITICAL #2: GamePicker overwrite race fixed (moved into `<Topbar fixedTrailing={<GamePicker/>}/>`).
- CRITICAL #1: cross-route topbar leakage fixed (`useTopbarTrailing()` gates via `useRouteMatch`).
- HIGH #3: DetailTopbarActions closure widened deps.

**NOT done (deferred per plan spec):**
- `src/components/Header/` deletion (kept for one release per request).
- `src/pages/Index/` deletion (kept for barrel test compat).
- `design-reference/` vendoring (deferred).

vitest: 694/694 PASS.

## Next Steps

Phase 7 rewrites Segments library to Hermes style. Phase 8 restyles segment detail. Phase 9 visual + E2E validation.
