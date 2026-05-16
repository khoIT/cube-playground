---
phase: 2
title: "Shell + Source step + /metrics/new route (RR5) + meta bootstrap"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Shell source route meta-bootstrap

## Overview

Stand up the routed full-page wizard shell and Step 1 (Source). End-to-end demoable behind `?v=2`. Top app bar, 260 px left rail (identity hero + 6-row vertical step nav + validation card), center body, 420 px right rail, footer. Source step lists cubes/views with rows·cols·refreshed·tags from extended `/meta`; right-rail shows column-type histogram of the selected source. Discard → confirm → `history.push('/build')`. Draft survives reload (localStorage hydration tested in P1).

**Red-team-applied:** RR5 idioms (no `useNavigate`/`useSearchParams`/`element=`); route mounted with own `useNewMetricMeta` bootstrap (AppContext lacks meta); `?cube=` validated against `meta.cubes`; `/playground` → `/build`; new tree lives under `src/QueryBuilderV2/NewMetric/full-page/` (single namespace).

## Requirements

**Functional:**
- Route `<Route path="/metrics/new" component={NewMetricPage} />` mounted in `src/index.tsx` (RR5 style, alongside existing `/build`, `/schema`, `/catalog`). HashRouter preserved.
- `NewMetricPage` reads `?v=2` via `new URLSearchParams(useLocation().search)` (RR5). When `?v=2` absent, falls through to legacy entry (existing Dialog reachable via header button without route).
- Page mounts its own meta bootstrap via `useNewMetricMeta()` from P1 — does NOT depend on `useAppContext` having `meta`/`cubejsApi` (it doesn't; verified red-team finding #5).
- Header `New metric` button (`NewMetricButton.tsx`) gated on `?v=2` env (or always-on per cutover plan) — renders `<Link to="/metrics/new?v=2">` from RR5 when v2; existing `<DialogTrigger>` otherwise.
- Shell: `<TopBar>` (logo + breadcrumb Playground › Metrics › New metric + Save draft / Help / Discard), `<LeftRail>` (identity hero + step nav + validation card), `<Main>` (StepHeader + body + StepFooter), `<RightRail>` (title + subtitle + content slot).
- LeftRail step rows: number/check badge, name, summary line under name, optional right-edge step-specific badge.
- LeftRail validation card: 4 items (Source selected · Operation chosen · Identity set · Test run passed); pass count "N/4".
- Source step: filter bar (search + Schema + Domain + Kind + Owner dropdowns — visual stubs), 2-col card grid. Card shows name, schema, domain pill, kind icon, description, rows·cols·refreshed, tag chips, deprecated badge.
- Right rail (Source step): selected source's header, "Schema · top columns" list (first 6 cols), "Columns by type" segmented bar.
- StepFooter: `Step 1 of 6 · Source` left, [Back disabled, Continue → Operation step] right.
- **`?cube=` validation:** on mount, read `?cube=`; reject (treat as absent) unless `meta.cubes.some(c => c.name === cubeParam)`. Selecting an out-of-meta cube silently fails — log + continue with no pre-selection.
- Discard button → confirm dialog → `localStorage.removeItem(...)` (tab-scoped key from P1) → `history.push('/build')`.
- Save draft button → antd `notification.info({ message: 'Draft saved' })` (storage write already debounced in P1).
- Reload: draft restored from localStorage (P1 logic); lands on last active step (this phase only Step 1). `BroadcastChannel('new-metric')` from P1 disables Submit if another tab is editing.

**Non-functional:**
- Every new file < 200 LOC. Step body + rail in separate files.
- CSS variables from `src/theme/tokens.css`. No hard-coded brand colors.
- Skeleton shimmer for source cards while `useNewMetricMeta` loads.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/                   (NEW subdir, single namespace)
├── NewMetricPage.tsx                                     route component, mounts useNewMetricMeta + Shell
├── shell/
│   ├── shell.tsx
│   ├── top-bar.tsx
│   ├── left-rail.tsx
│   ├── left-rail-step-row.tsx
│   ├── validation-card.tsx
│   ├── right-rail.tsx
│   ├── step-header.tsx
│   ├── step-footer.tsx
│   └── discard-confirm-dialog.tsx
├── steps/
│   └── step-1-source/
│       ├── index.tsx
│       ├── source-body.tsx
│       ├── source-card.tsx
│       ├── source-filter-bar.tsx
│       └── source-preview-rail.tsx
└── hooks/
    └── use-active-step.ts
```

Route registration: `src/index.tsx` gets a new `<Route path="/metrics/new" component={NewMetricPage} />`.

`NewMetricButton.tsx` (existing) wraps in `<Link to="/metrics/new?v=2">` when env / URL flag is set.

## Related Code Files

- **Create:** `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx`
- **Create:** `src/QueryBuilderV2/NewMetric/full-page/shell/*.tsx` (8 files)
- **Create:** `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/*.tsx` (4 files)
- **Create:** `src/QueryBuilderV2/NewMetric/full-page/hooks/use-active-step.ts`
- **Create:** `src/QueryBuilderV2/NewMetric/full-page/__tests__/new-metric-page.test.tsx`
- **Create:** `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/__tests__/source-card.test.tsx`
- **Modify:** `src/index.tsx` — add `<Route path="/metrics/new" component={NewMetricPage} />` after existing routes
- **Modify:** `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx` — gate on `?v=2`; render RR5 `<Link>` when v2

## Implementation Steps (TDD)

1. **Verify route mount surface** — read `src/index.tsx` to confirm route table position (`/`, `/build`, `/schema`, `/catalog`); decide insertion order (place `/metrics/new` before catch-all). Confirm `<Router>` is a HashRouter and routes use RR5 `component=` or render-prop.
2. **Verify AppProvider wraps the new route** — `src/App.tsx` provider tree wraps `<Switch>`; `<NewMetricPage>` will sit inside it. `useAppContext()` returns `{ apiUrl, token, schemaVersion, refreshMeta, … }` — confirm shape before wiring.
3. **Write tests first:**
   - `new-metric-page.test.tsx` — renders Shell, default step is 1, breadcrumb shows `New metric`. `?v=2` URL renders new shell; missing `?v=` (or `?v=1`) does NOT render (control passes to legacy entrypoint).
   - `source-card.test.tsx` — name + schema + domain pill render; click fires `onClick`; `selected=true` adds brand border; `deprecated=true` adds badge + dims to 70%.
   - `use-active-step.test.ts` — restores last step from draft.
   - `cube-param-validation.test.tsx` — `?cube=mf_users` (in meta) pre-selects; `?cube=evil_cube` (not in meta) ignored + no pre-selection.
4. **Build Shell components** — `shell.tsx`, `top-bar.tsx`, `left-rail.tsx`, `left-rail-step-row.tsx`, `validation-card.tsx`, `right-rail.tsx`, `step-header.tsx`, `step-footer.tsx`. Use styled-components + tokens. Mirror reference layout dimensions (top bar 56 px, left 260 px, right 420 px).
5. **Build Source step body** — filter bar (search input + 4 dropdown stubs), 2-col card grid. Source card matches mockup.
6. **Build Source right rail** — header card, columns list (top 6), type-distribution bar.
7. **Wire NewMetricPage** — call `useNewMetricMeta()` (from P1); pass cube list to Source step. `useNewMetricDraft` (v2) drives state. Active-step derives from draft + URL hash (`#step-N`).
8. **Read `?cube=` via RR5** — `const search = new URLSearchParams(useLocation().search); const cubeParam = search.get('cube');` — and validate against `meta.cubes` before applying as source.
9. **Add route** in `src/index.tsx`. Confirm `<AppContextProvider>` wraps it (read `src/App.tsx`).
10. **Gate the entrypoint** — `NewMetricButton.tsx` reads `?v=2` from URL (`useLocation()`) or env `VITE_NEW_METRIC_V2`; renders `<Link to="/metrics/new?v=2">` (RR5) when set, existing `<DialogTrigger>` otherwise.
11. **Wire localStorage hydration** — `use-new-metric-draft` (extended in P1) already loads on mount; verify on full reload mid-Source-selection.
12. **Wire Discard** — confirm dialog → clear localStorage tab-scoped key → `history.push('/build')`.
13. **Wire Save draft** — antd `notification.info({ message: 'Draft saved' })`.
14. Manually QA in browser: load `#/metrics/new?v=2`, pick a cube, reload — selection survives. Discard → confirm → lands on `#/build`. Open in second tab → first tab disables submit per `BroadcastChannel`. Craft `#/metrics/new?v=2&cube=bogus` URL → no pre-selection.
15. Run `npm run typecheck` + `npm run test` + `npm run build`. Commit.

## Success Criteria

- [ ] `#/metrics/new?v=2` renders the 3-column shell with TopBar + LeftRail + Main + RightRail + StepFooter.
- [ ] Header `New metric` button navigates to `#/metrics/new?v=2` (when flag on).
- [ ] LeftRail shows 6 step rows; Step 1 active; validation card shows 0/4 pass.
- [ ] Source step grid lists every cube + view from `useNewMetricMeta`'s `/meta?extended=true`. Cards render rows·cols·tags·domain·kind.
- [ ] Clicking a source highlights the card, populates right rail with column-type bar + top-6 columns, validation 1/4.
- [ ] Continue enables once source picked; navigates UI state to Step 2 placeholder.
- [ ] Discard button shows confirm; on accept clears tab-scoped localStorage key and navigates to `#/build`.
- [ ] Reload mid-flow restores selected cube.
- [ ] `?cube=` query param: valid cube pre-selects; invalid cube silently ignored.
- [ ] Multi-tab: opening a 2nd `#/metrics/new` tab triggers `BroadcastChannel` event; 1st tab shows "Another tab is editing" banner + disables Submit (Submit appears at P7 — wire the banner now).
- [ ] `?v=1` (or absent) still opens the old Dialog without regression.
- [ ] No `useNavigate`, `useSearchParams`, `<Routes>`, or `element=` in any new file (grep clean).
- [ ] No `dangerouslySetInnerHTML` in any new file.
- [ ] Every new file < 200 LOC. Typecheck + tests green.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| `AppContext` doesn't carry `meta`/`cubejsApi` — discovered by red-team #5 | P1 ships `useNewMetricMeta`; this phase consumes it. No reliance on `useAppContext().meta`. |
| HashRouter URL parsing edge cases (`#/metrics/new?v=2` vs `?v=2#/metrics/new`) | Read params from `useLocation().search` (RR5), which already accounts for hash. Tested in `new-metric-page.test.tsx`. |
| ui-kit `Dialog` styled-components conflict with new styled scope | New shell does NOT use ui-kit for layout — only buttons/inputs where convenient. Custom styled-components for shell primitives. |
| Reference design tokens missing in `tokens.css` | Add missing ones in Step 4 — verify all referenced vars exist before consumption. |
| Cube list pagination on bigger metas | Out of scope this POC — ballistar_vn ≈ 4 cubes + 7 views. Note for future. |
| `?cube=` deep-link traversal (red-team #11) | Validation step 8 against `meta.cubes` catches it. P1 server-side path-resolution remains the backstop. |
| RR5 + HashRouter route ordering | Add `/metrics/new` before any catch-all; tested by mount-render assertion. |
