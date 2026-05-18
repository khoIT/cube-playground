# Code Review — GDS Cube UI Revamp (Stitch)

**Plan:** `plans/260515-1318-gds-cube-ui-revamp-stitch/plan.md`
**Scope:** new files in theme/, components/Header/, hooks/use-cube-alias, QBv2 new components, plus edits in App.tsx / Header.tsx / QueryBuilderInternals.tsx / QueryBuilderChartResults.tsx / QueryBuilderToolBar.tsx / SidePanelCubeItem.tsx / index.html.
**Verified:** `lucide-react@1.16.0` is the current 2026 release (PascalCase exports valid). antd `4.16.13` → `visible/onVisibleChange` Popover API correct. `updateQuery(fn)` callback form valid (matches `QueryBuilderExtras.tsx:430`). `filters.remove(index)` valid (matches `QueryBuilderFilters.tsx:170`).

## Critical
None blocking. Build passes, no new TS regressions reported.

## Important

1. **`use-cube-alias` listener registration runs at module load before any DOM.**
   `window.addEventListener('storage', ...)` at module top‑level (lines 41-47) — fine in browser SPA, but the listener never unsubscribes. Acceptable for a singleton-lifetime app; flag if the module ever gets hot-reloaded under HMR (you'll accumulate listeners). Consider gating with `if (!(window as any).__alias_listener_bound)`. — `src/hooks/use-cube-alias.ts:41`

2. **Stale-closure in `useCubeAlias.update` / `reset`.**
   `update` depends on `[map, name]` and writes `{ ...map, ...patch }`. Two rapid `update()` calls on the same hook instance can race: each computes from the same `map` snapshot, second overwrites first. In practice the editor is single-form click-save so unlikely to fire; flag only. Fix would be `setMap(prev => …)` reads via the broadcast path before persisting, OR re-read `loadMap()` inside `update`. — `src/hooks/use-cube-alias.ts:61-75`

3. **`DateRangeStrip` closure captures `timeDimensions` array from outer scope inside `updateQuery` callback.**
   `updateQuery(() => ({ timeDimensions: timeDimensions.map(...) }))` ignores the callback's prev-state arg. If the user clicks two presets fast and the first hasn't committed, second will base its map on the *stale* outer closure. Use `updateQuery((prev) => ({ timeDimensions: (prev.timeDimensions ?? []).map(td => ({...td, dateRange: preset.value})) }))`. — `src/QueryBuilderV2/components/date-range-strip.tsx:84-90`

4. **`<QueryStatePillBar/>` is mounted inside a `useMemo` block with deps `[isChartExpanded, chartSize, ResultsAndSQL]`.**
   The pill bar element is a stable JSX node; the *component* still re-renders on its own context subscriptions. Verified — no bug, but the memo is doing nothing for the pill bar. Either accept (it memoes the wrapping fragment + chart), or extract pill bar outside the memo for clarity. — `src/QueryBuilderV2/QueryBuilderInternals.tsx:127-146`

5. **Filter pill label for logical filters is just `"filters"`.**
   `'member' in f` is false for `LogicalAndFilter` / `LogicalOrFilter`; falls through to label `"filters"`. Removal-by-index still works, so functional. Cosmetic — show `"AND (n)"` / `"OR (n)"` to avoid confusing UX when filters get nested. — `src/QueryBuilderV2/QueryStatePillBar.tsx:123-138`

6. **`QueryBuilderInternals.tsx:32`** redeclares `type Tab` immediately after `import {... Tab ...}` from `./components/Tabs`. The local `type Tab` shadows the imported component value in scope below, but JSX usage `<Tab id=...>` still resolves to the value-binding — works due to TS type/value namespace separation. Confusing; rename local type to `TabKey`. — `src/QueryBuilderV2/QueryBuilderInternals.tsx:32`

## Nits

- `cube-row-editor.tsx`: `Hint` says "Display only — model file is unchanged" but ResetLink label "Reset" sits next to it; consider renaming to "Reset alias" to match D1's "client-side alias" framing.
- `icon-picker.tsx:112` casts `LucideIcons as Record<string, any>` — fine, but the `NON_ICON_KEYS` guard is defensive enough that the `if (!Cmp) return null` fallback (line 113) is unreachable. Harmless.
- `member-pill-row.tsx`: `extra` prop is declared in `PillItem` but never populated by `QueryStatePillBar`. Dead surface area — drop or use for the filter operator chip.
- `chart-kpi-cards.tsx`: silent `catch { return null }` swallows `series()` failures. Add a one-liner `console.warn` so QA can see series shape issues during smoke.
- `Header.tsx`: imports antd `Menu` for the mobile Dropdown only — fine, but `Menu.Item` will need an `onClick` to close; current dropdown leaves keyboard nav slightly clunky. Functional, not blocking.
- `tokens.css` redeclares `:root` font-family on `html, body` — duplicates the UI-kit `rootStyles.fontFamily` resolved through `<Root>`. No conflict, just two sources of truth.
- `theme-color` meta is `#f05a22` (brand) — matches token. Good.

## D10 Compliance

Verified: changes to QBv2 are restricted to (a) `QueryBuilderInternals` mount point (`<QueryStatePillBar/>`), (b) tab labels (Results/SQL/SQL API/REST/GraphQL), (c) `QueryBuilderChartResults` injecting `<ChartKpiCards/>`, (d) `QueryBuilderToolBar` removing the in-toolbar Run button, (e) `SidePanelCubeItem` adding alias display + `<CubeRowEditor/>` trigger. No logic changes to query mutation paths.

## Token / UI-kit Conflict

`ROOT_STYLES = { ...rootStyles, ...QUERY_BUILDER_COLOR_TOKENS }` — order correct: QBv2 Less variable overrides win over our token bridge inside the QueryBuilder Panel. No collision because keys are disjoint (`--primary-color`/`--purple-color` from us vs. `@primary-color` Less names from QBv2 token map). Confirmed safe.

## Plan Fidelity

| Phase | Status |
|---|---|
| 1 Tokenisation | met — tokens.css + antd-overrides.css + rootStyles bridge |
| 2 Top Bar | met — BrandBlock + NavPill + mobile dropdown |
| 3 Schema Sidebar | met — useCubeAlias + CubeRowEditor + monospace real-name |
| 4 Pill Bar | met — 4 rows, Run, Live badge, DateRangeStrip |
| 5 Results/Chart | met — KPI cards, tab rename |
| 6 Polish | smoke pending |

## Unresolved Questions

1. Should `useCubeAlias` use `BroadcastChannel` instead of `storage` event for in-tab cross-component sync? Current `listeners` Set works but couples writes to one module instance — fine for SPA.
2. `DateRangeStrip` Custom preset is a no-op — intentional fallthrough to existing per-dimension popover, or should it open a date picker?
3. `QueryStatePillBar`'s `onAdd` is never wired (`undefined`) — Add button never renders. Confirm: dimensions/measures added via sidebar only, no add affordance in pill bar by design?

**Status:** DONE_WITH_CONCERNS
**Summary:** No blocking issues; build passes; D10 honored. Six "important" items are correctness-leaning (stale closure in date-range, listener leak under HMR, redeclared `Tab` shadow) and should be addressed before shipping wider.
**Concerns/Blockers:** stale-closure race in `DateRangeStrip` + `useCubeAlias.update` if user double-clicks fast; rest is polish.
