---
phase: 6
title: "Catalog Models tab + schema route migration"
status: completed
priority: P1
effort: "3h"
dependencies: [4]
---

# Phase 6: Catalog Models tab + schema route migration

## Overview

Nest the Models browser (current `SchemaPage` at `/schema`) as a tab inside `/catalog`. Catalog page grows a tab strip with two tabs: **Catalog** (default, current grid) and **Models**. Add a redirect from `/schema` → `/catalog/models` so existing deep links keep working.

## Requirements
- Functional: `/catalog` shows the current catalog grid (Catalog tab active). `/catalog/models` shows the SchemaPage tree (Models tab active). `/schema` redirects to `/catalog/models`. Tab switching uses react-router navigation (URL-driven, not local state) so deep links land on the right tab. Tab labels translated.
- Non-functional: SchemaPage retains all current behavior (`/cubejs-api/v1/meta` fetch + Antd Tree + tabs for schema/files). No styling overhaul this round.

## Architecture
- `src/pages/Catalog/catalog-tabs.tsx` — antd `Tabs` strip with two TabPanes; the active tab is derived from `useLocation().pathname` (matches `/catalog/models` → Models else Catalog). Switching tabs calls `history.push('/catalog' | '/catalog/models')`.
- `src/pages/Catalog/catalog-page.tsx` — wraps existing body inside the `Catalog` tab content. The Models tab content is `<SchemaPageWithRouter />` reused (it already takes RouterProps via `withRouter`).
- **SchemaPage refactor (required, not optional):** <!-- Updated: Validation Session 1 - drop outer Layout/Sider chrome --> SchemaPage's current render returns `<Layout style={{ height: '100%' }}><Sider width={340}>…</Sider><Content>…</Content></Layout>`. To embed cleanly inside the catalog tab body without double chrome, swap that outermost wrapping for a plain flex row:
  - Replace `<Layout style={{ height: '100%' }}>` with `<div style={{ display: 'flex', height: '100%', background: 'var(--bg-app)' }}>`.
  - Replace `<Sider width={340} className="schema-sidebar">` with `<aside style={{ width: 340, flexShrink: 0, borderRight: '1px solid var(--border-card)', overflowY: 'auto' }}>`.
  - Replace `<Content style={{ minHeight: 280, padding: 24 }}>` with `<section style={{ flex: 1, overflow: 'auto', padding: 24 }}>`.
  - Drop antd `Layout`, `Sider`, `Content` destructure at the top of SchemaPage.
  - Internal `<Tabs>` + `<TreeNode>` + tab-bar extra content remain untouched.
- Routing change in `src/index.tsx`:
  - Replace `<KeepAliveRoute key="schema" path="/schema">` with `<Route exact path="/schema"><Redirect to="/catalog/models" /></Route>` (RR5).
  - Update the existing catalog route to match both `/catalog` and `/catalog/models` (`path="/catalog"` already prefix-matches; keep KeepAlive).
- Catalog `Header` title + count remain above the tab strip; both tabs render below them. The strip itself is sticky to the top of the catalog body for clarity.

## Related Code Files
- Create: `src/pages/Catalog/catalog-tabs.tsx`
- Modify: `src/pages/Catalog/catalog-page.tsx`, `src/pages/Schema/SchemaPage.tsx` (drop Layout/Sider/Content wrappers), `src/index.tsx`

## Implementation Steps
1. **Refactor SchemaPage chrome** (separate step before catalog wiring):
   - Drop `const { Content, Sider } = Layout;` destructure.
   - In `render()`, replace outer `<Layout style={{ height: '100%' }}>...</Layout>` with the plain-div flex layout described in Architecture above.
   - Run `npm run typecheck` + visit `/schema` manually to confirm visual parity before nesting.
2. Create `catalog-tabs.tsx` rendering antd `Tabs` with two `TabPane`s. Active key from `location.pathname` (`endsWith('/models') ? 'models' : 'catalog'`). `onChange` pushes the corresponding path.
3. Refactor `catalog-page.tsx`:
   - Extract the current body (header + toolbar + grid + detail panel) into a `CatalogBrowseBody` component.
   - In the default export, render the page chrome + `<CatalogTabs>` and switch body: `pathname.endsWith('/models') ? <SchemaPageWithRouter /> : <CatalogBrowseBody />`.
4. In `src/index.tsx`:
   - Remove `<KeepAliveRoute key="schema" path="/schema">…</KeepAliveRoute>`.
   - Add `<Route exact path="/schema"><Redirect to="/catalog/models" /></Route>` (import `Redirect`).
   - Confirm `<KeepAliveRoute key="catalog" path="/catalog">` still matches `/catalog/models` (RR5 prefix match — yes by default).
5. Verify `SchemaPage` still receives valid `RouterProps` when rendered inside the catalog tab.
6. Ensure the tab strip translates: `t('tabs.catalog')`, `t('tabs.models')`.
7. Manual smoke: visit `/catalog`, click Models tab, observe URL change to `/catalog/models`, see schema tree. Hit `/schema` directly → redirected.

## Success Criteria
- [ ] `/catalog` renders the current catalog grid with both tabs visible; Catalog tab active.
- [ ] `/catalog/models` renders the SchemaPage tree; Models tab active.
- [ ] `/schema` 302s to `/catalog/models` (visible in browser URL bar).
- [ ] Catalog detail panel + metric routing untouched (still uses `/metric/:cube/:member`).
- [ ] Tab labels translate per language.
- [ ] No TS / lint errors.

## Risk Assessment
- `SchemaPage` uses `AppContext` and `playgroundFetch`; both work regardless of which route mounts it. Verified by grep.
- KeepAlive: the catalog route stays mounted across navigation. The Models tab's `SchemaPage` will be inside that wrapper — its own `componentDidMount` (`loadDBSchema` + `loadFiles`) runs on first mount only, just as it does today. Should be fine.
- Existing tests / docs referencing `/schema` (e.g. README.md) updated post-merge.

## Security Considerations
- None.

## Next Steps
- Phase 8 covers tests for the redirect + tab switching.
