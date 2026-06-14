# CS Console — header compaction + flow-nav into top navigation

**Goal:** Reclaim vertical whitespace on the 4 CS surfaces (Monitor, Queue, Member-360, Playbooks editor) by lifting the 3-step flow-nav out of each page body into the global Topbar, then tightening headers + table density to the `VIP Care CS Console Flow.html` design spec.

## Locked decisions (user)
1. **Flow-nav → global Topbar** (CS routes only). Matches design where the flow-map lives in `.topbar`.
2. **Tighten headers, no eyebrow.** Normalize icon→24px, maxWidth→1320, subhead margin; unify all 4. Drop the builder's lone `CS · VIP Care` eyebrow to unify.
3. **Headers + table density.** Align Monitor grid (the roomy one) + Queue tables to design thead `8px 16px`/10.5px, tbody `10px 16px`/12.5px.

## Design spec (from HTML tokens)
- `.content` padding `24px 32px`, maxWidth 1320, margin 0 auto.
- `.pagehead` gap 11, icon 24 brand, h1 20/700/-.02em; `.subhead` 12.5 muted, margin `2px 0 20`.
- `.flowmap` lives in 56px topbar; `.fm-step` pills 12px, padding 5px 11px.
- table thead `8px 16px` 10.5px upper; tbody `10px 16px` 12.5px.

## Approach (lowest-coupling)
Keep `cs-console-nav.tsx` (+ its passing test) as the presentational component; add a **non-breaking `variant?: 'page'|'topbar'`** (default `page`, only changes the `<nav>` wrapper margin/flex). Add a shell hook `useCsFlowNav()` that route-drives `current` + reads `gameId` from `useGameContext`, returning the topbar-variant nav or `null`. Topbar renders `{csNav ?? <Breadcrumb/>}`. No KeepAlive concern — CS routes are plain `<Route>` in a `<Switch>` (index.tsx:241), and the hook is route-driven, not page-registered.

## Files
- NEW `src/shell/topbar/cs-flow-nav.tsx` — `useCsFlowNav(): ReactNode | null`; path→step map (`/dashboards/cs`→monitor, `/queue`→queue, `/members/`→member; playbooks + non-cs → null).
- `src/shell/topbar/topbar.tsx` — leading = `{csNav ?? <Breadcrumb/>}`.
- `src/pages/Dashboards/cs/cs-console-nav.tsx` — add `variant` prop (topbar: marginBottom 0, flex 1, nowrap).
- `src/pages/Dashboards/cs/index.tsx` — drop in-body `<CsConsoleNav>`.
- `src/pages/Dashboards/cs/case-ledger.tsx` — drop nav; icon 22→24; maxWidth 1400→1320; cell hpad 14→16.
- `src/pages/Dashboards/cs/member360/cs-member360-view.tsx` — drop nav; icon 22→24.
- `src/pages/Dashboards/cs/playbook-builder.tsx` — drop eyebrow; icon 22→24; maxWidth 1240→1320.
- `src/pages/Dashboards/cs/playbook-grid.tsx` — cellBase 14px20px→10px16px; thStyle 10px20px→8px16px.

## Acceptance
- On `/dashboards/cs`, `/queue`, `/members/:uid` the flow-nav appears in the Topbar with the right active step + game param; gone from page bodies.
- Builder + non-CS routes show no flow-nav (Breadcrumb fallback intact).
- Headers: 24px icon, maxWidth 1320, no eyebrow, design subhead margin, all 4 consistent.
- Monitor grid + Queue tables at design density. No new type/lint/test failures; `cs-console-nav.test.tsx` stays green.

## Out of scope
- Breadcrumb STATIC entries for `/dashboards/cs`. Sidebar. Table content/columns. Builder form width beyond maxWidth.
