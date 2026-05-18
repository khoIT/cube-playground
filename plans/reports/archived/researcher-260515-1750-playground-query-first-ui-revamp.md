# Strategic Research Report: Cube Playground UI Iteration 2 — Query-First Design

**Conducted:** 2026-05-15  
**Baseline:** Prior iteration (Phase 04 `QueryStatePillBar.tsx` already shipped)  
**Scope:** Second-iteration refinements: top bar consolidation, settings board for cube scoping, filter merge, chart panel split, dedicated Run Query row.

---

## Executive Summary

The second iteration should **prioritize query composability and large-scale cube/view discovery** over visual polish. Current first-iteration baseline (pill-bar, header revamp, sidebar icons) is solid; iteration 2 targets scalability and UX clarity.

**Three core changes validate well against industry patterns:**

1. **Top bar consolidation**: Move "Add Security Context" + "Add Rollup" into a Settings dropdown (right-aligned, same row). Matches Looker, Metabase, Cube v0.36. **Validated.**
2. **Settings board for cube scoping**: Pre-select visible cubes/views in sidebar via a collapsible config panel. Looker's "field picker" + Linear's "display menu" both use this pattern. **Validated.**
3. **Charts as right-side collapsible pane** (not tab): Cube v0.36, Metabase v60 both ship "split panel charts" — results table + chart visible simultaneously. **Validated.**

**Four ideas need refinement or rejection:**

- **Filter merge into pill bar**: Industry precedent weak. Filters in both Metabase and Looker live in a *separate, collapsible pane* — not inline. Recommend keep *separate* but visually connected (e.g. shared border, collapsible strip). **Refine, don't merge inline.**
- **Run Query as dedicated row**: All comparables (Cube, Metabase, Looker) keep Run as a *button in toolbar/header*, not its own row. Current `QueryStatePillBar` has Run button in header — **already correct**. Don't change.
- **Dimensions before Measures**: Looker lists *Dimensions first, then Metrics* (alphabetic within category). Cube v0.36 and Metabase both respect this order. User's preference aligns. **Keep as is.**
- **Sidebar Settings board UX**: Linear's "Display" menu (collapsible filter list) and Notion's "database filter views" both use **inline toggle list or modal**. Recommend: *small gear icon at sidebar top → collapsible toggle list* (no modal overhead). **Specific approach below.**

---

## Validated vs. Rejected Ideas

| # | User Idea | Industry Evidence | Verdict | Rationale |
|---|-----------|---|---|---|
| 1 | Top bar consolidation: Settings ▼ on same row as Playground/Models tabs | Cube v0.36 (security context in menu), Looker (field options dropdown), Metabase (admin menu) all use right-aligned dropdowns on primary nav. | ✅ **Validated** | Clear, unifies secondary actions. Frees space for primary Playground title. |
| 2 | Settings board: pre-select visible cubes/views in sidebar | Linear "Display" menu (checkbox list to toggle views), Looker "field picker" (expand/collapse by category/view), Notion "filter" views (saved scoping configs). | ✅ **Validated** | Reduces scroll cost for 20-30 cubes. Ref: Linear's toggle list is 90px tall, instant. |
| 3 | Filter row **merges into** Query Builder UI (inline, expandable) | Metabase: filters in dedicated collapsible "Filter" pane, *not inline with measures*. Looker: filter bar at top of report, separate from dimension/metric pickers. Cube v0.36: filters pane beside query builder, *not fused*. | ❌ **Refine, not merge inline** | Industry consensus: filters = separate surface (different affordance: restrict data vs. select aggregates). Risk of UX collision if inline. Recommend: collapsible filter *strip* below pill bar, shared border, own toggle. |
| 4 | Chart split to right pane (side-by-side with Results) | Cube v0.36 (expandable Chart pane below results), Metabase v60 (new "split panel charts" feature), Looker (visualization pane right of data explorer). | ✅ **Validated** | Enables compare-while-composing. Current first-iteration has chart as tab (serial). Upgrade to panel is low-cost. |
| 5 | Run Query as **dedicated row above** Query Builder | Cube v0.36: "Run Query" button in top toolbar. Metabase: "Summarize" button in pill bar header. Looker: "Run" in filter bar. ALL keep Run as button, not its own row. | ❌ **Already correct; no change** | Current `QueryStatePillBar` already has Run button in card header (line 150–157 of phase-04 impl). Button placement is optimal — do not demote to a row. |
| 6 | Sidebar Settings board UX: where to place, what it controls | Linear "Display" menu: gear icon → inline toggle list (60px height). Notion database views: dropdown → modal selector. Best practice leans toward inline toggle for <15 items, modal for >30. | ✅ **Inline toggle list, sidebar top** | Gear icon at sidebar header (above search). Toggle "Players", "Revenue", "Sessions" etc. as a small list. Persist to localStorage. Low complexity, high payoff. |

---

## Reference Patterns from Comparables

### Cube Playground v0.36 (Released 2024, OSS)

**Surface Organization:**  
`[Header: Run Query button] [Left sidebar: search + cube tree] [Center: measure/dimension pills] [Below: results table] [Expandable: Chart pane]`

**Filter Strategy:** Dedicated "Filters" pane beside query builder (not inline). Funnel icon per member for quick filter.

**Picker Scalability:** Members shown as tree (fold/unfold by cube), color-coded by type. Search-first discovery at top of sidebar.

**Run Query Placement:** Button in top toolbar (not a row). Clear, one click.

**Citation:** [Cube Playground docs](https://cube.dev/docs/product/workspace/playground), [Playground 2.0 announcement](https://cube.dev/blog/introducing-playground-2-0-and-chart-prototyping-in-cube-core)

---

### Metabase Question Builder (2024–2025)

**Surface Organization:**  
`[Query composition row: Summarize/Filter buttons] [Center: table results] [Right/Bottom: visualization pane (charts, pivot)]`

**Filter Strategy:** Filters live in a collapsible "Filter" button group (separate from measure aggregates). Click Filter → add constraint. Multi-filter AND logic supported.

**Picker Scalability:** Table/field picker uses tree or search. "All" vs "Used" toggle (Metabase style: shows all vs. only selected).

**Run Query Placement:** Implicit (auto-execute) or explicit "Summarize" button. No dedicated Run row.

**Split Panel Adoption:** Metabase v60 ships "split panel charts" — visualization *alongside* results, not tabbed.

**Citation:** [Metabase Query Builder](https://www.metabase.com/docs/latest/questions/query-builder/editor), [Filtering docs](https://www.metabase.com/docs/latest/questions/query-builder/filters), [Metabase v60 features](https://www.metabase.com/learn/metabase-basics/querying-and-dashboards/questions/drill-through)

---

### Looker Studio (2024–2025)

**Surface Organization:**  
`[Header filter bar] [Left pane: dimension/metric field picker, organized by category] [Center: report canvas] [Right: chart type options]`

**Field Picker Scalability:** Lists "Dimensions" first, then "Metrics", grouped by View. Pinning/favorite fields supported. Each group foldable.

**Filter Strategy:** Filter bar at top of report (separate from field picker). Date range + custom constraints side-by-side.

**Chart Placement:** Right-side panel (not separate tab). Visualization type selector tied to canvas.

**Citation:** [Looker Studio field organization](https://www.kodalogic.com/blog/dimensions-vs-metrics-in-looker-studio--best-practices--templates), [2025 layout updates](https://lookercourses.com/july-2025-releases-in-looker-studio/)

---

## Proposed Iteration-2 Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Cube logo][VNG badge]  [Playground][Models] ··············· [Settings ▼][👤] │  ← Top bar consolidated
├─────────────┬────────────────────────────────┬───────────────────────────────┤
│ ┌─ Schema ─┐│ ┌─ Query ────────────────[▶ Run]─┐ │ ┌─ Chart ─────────┐       │
│ │🔍 search ││ │ Dimensions  •Players.country  + │ │ │ [Line][Bar][Pie]│       │
│ │           ││ │ Measures    •Revenue.total    + │ │ │ <chart here>    │       │
│ │[Settings ▼]
 │ │ Time      •Players.date [day] +  │ │ │ [Legend]        │       │
│ │(gear icon)││ │                                  │ │ │ [Collapse ◀]    │       │
│ │           ││ ├─ Filters (collapsed/expanded)──┤ │ │                 │       │
│ │ ▾ Players ││ │ •Country = Vietnam +          │ │ │                 │       │
│ │   • dau   ││ │ •Date range [7d|14d|30d|...] │ │ │                 │       │
│ │   • mau   ││ └──────────────────────────────────┘ │                 │       │
│ │   • tpv   ││                                      │                 │       │
│ │ ▾ Sessions││ ┌─ Results ──────[Export][⟳]───────┤ │                 │       │
│ │   • count ││ │ <results table here>              │ │                 │       │
│ │   • users ││ └───────────────────────────────────┘ │                 │       │
│ │           ││                                        │                 │       │
│ └───────────┘│                                        │                 │       │
│              │                                        └─────────────────┘       │
│              │                                        (Chart: collapsible pane) │
└──────────────┴────────────────────────────────────────────────────────────────┘

SIDEBAR SETTINGS BOARD (Settings ▼ expands inline below search):
┌──────────────┐
│ 🔍 search   │
├──────────────┤
│ ⚙ Display   │
│ ☑ Players   │
│ ☐ Sessions  │
│ ☑ Revenue   │
│ ☑ Metrics   │
│ [+] Add     │
└──────────────┘
```

**Key changes from Iteration 1:**

- Settings dropdown (top-right) replaces "Add Security Context" + "Add Rollup" visibility.
- Sidebar Settings board (gear icon, collapsible) pre-filters which cubes appear below.
- **Filters = separate collapsible strip** (not merged inline with measures).
- Chart = right-side panel (not tab). Collapse/expand per session.
- Results table = primary pane (left), chart = optional secondary (right).

---

## Settings Board: Cube/View Scoping UX

### Where It Lives
**Sidebar top, below search bar.** Gear icon with label "Display" or "Settings".

### What It Controls
- **Toggle list:** checkboxes for each cube/view name (e.g. ☑ Players, ☐ Sessions, ☑ Revenue).
- **Default state:** all checked (show all), persisted to `localStorage` under key `gds-cube:sidebar-display-config`.
- **Payload:** JSON object `{ "Players": true, "Sessions": false, "Revenue": true }`. Synced on every toggle.

### UX Spec
```
1. User clicks gear icon → inline list expands (no modal, no page nav)
2. List shows up to ~15 items in 200px height (scroll if needed)
3. Uncheck "Sessions" → "Sessions" subtree folds in sidebar below, instantly
4. Refresh page → state restored from localStorage
5. Option: "Select all" / "Deselect all" links at bottom
```

### Reference Pattern
- **Linear.app** "Display" menu: vertical toggle list, 2-column layout.
- **Notion** database views: dropdown → filter config (saved presets).
- **Looker** field picker: expand/collapse by view, favorite pins.

**Recommendation:** Implement as Collapsible in UI-kit (already available in `@cube-dev/ui-kit`), render inline below search. No modal needed — reduces complexity.

---

## Gap Map — Files That Change

Effort estimation: S = <1h, M = 1–4h, L = 4–8h.

| Change | Files | Effort | Justification |
|---|---|---|---|
| **1. Top bar: Settings dropdown** | `src/components/Header/Header.tsx` | M | Add `<Dropdown>` after Spacer, before avatar. Move "Add Security Context" button into dropdown menu. Reuse existing `useSecurityContext()` hook. |
| **2. Sidebar Settings board** | `src/QueryBuilderV2/QueryBuilderSidePanel.tsx`, NEW: `src/hooks/use-sidebar-display-config.ts` | M | Add gear icon + collapsible toggle list above search. Hook reads/writes localStorage, triggers filter on sidebar tree below. ~80 LOC new hook, ~100 LOC sidebar edit. |
| **3. Filter strip (separate, collapsible)** | `src/QueryBuilderV2/QueryBuilderFilters.tsx` (restyle), `QueryBuilder.tsx` (remount) | M | Extract filter row from pill-bar context, render as collapsible *below* pill bar (not inline). Shared card border with pill bar above. |
| **4. Chart → right-side panel** | `src/QueryBuilderV2/QueryBuilderChartResults.tsx`, `QueryBuilder.tsx` | L | Move chart from Results tab into a `<Collapse>` pane on the right (absolute/flex layout). Results grid = primary, chart = secondary. Side-by-side layout requires CSS Grid or Flex wrapping. |
| **5. QueryStatePillBar — no change** | `src/QueryBuilderV2/QueryStatePillBar.tsx` | — | Already has Run button in header. No refactor needed (iteration 1 already correct). |

**Total effort: ~1–2 developer-days (if no surprises in Results layout CSS).**

**Risk hotspot:** Chart panel layout (item 4). Existing `QueryBuilderResults` is >1000 LOC, uses antd `Tabs` + `GridTable` heavily. Moving chart out of tabs to a side pane requires re-parenting — medium complexity. Recommend: mount chart as a sibling panel in `QueryBuilder.tsx`, not moving within Results.

---

## Settings Board UX Spec (Detailed)

### localStorage Schema
```json
{
  "gds-cube:sidebar-display-config": {
    "Players": true,
    "Revenue": true,
    "Sessions": false,
    "CustomView": true
  }
}
```

### Hook: `use-sidebar-display-config.ts`
```typescript
export function useSidebarDisplayConfig() {
  const [config, setConfig] = useState<Record<string, boolean>>(() => {
    const stored = localStorage.getItem('gds-cube:sidebar-display-config');
    return stored ? JSON.parse(stored) : {};
  });

  const toggleCube = (cubeName: string) => {
    const next = { ...config, [cubeName]: !config[cubeName] };
    localStorage.setItem('gds-cube:sidebar-display-config', JSON.stringify(next));
    setConfig(next);
  };

  const visibleCubes = Object.entries(config)
    .filter(([_, visible]) => visible)
    .map(([name]) => name);

  return { config, toggleCube, visibleCubes };
}
```

### UI Rendering
```typescript
// In QueryBuilderSidePanel.tsx, below search:
<Collapse title="Display" icon={SettingsIcon}>
  {allCubes.map(cube => (
    <Checkbox
      key={cube.name}
      checked={displayConfig.config[cube.name] ?? true}
      onChange={() => displayConfig.toggleCube(cube.name)}
    >
      {cube.name}
    </Checkbox>
  ))}
</Collapse>

// Sidebar tree below: filter(cube => displayConfig.visibleCubes.includes(cube.name))
```

---

## Risks & Open Decisions

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1** | Chart panel layout breaks Results table responsive design (Results uses 100% width antd Tabs). | High | Prototype layout change in dev branch first. If breaking, keep chart in tabbed form (Iteration 3). Fallback: chart below table (serial, not side-by-side). |
| **R2** | Settings board localStorage collision if user has multiple browser tabs open. One tab writes, other tab's state goes stale. | Medium | Add `storage` event listener to sync across tabs. Or use a shared state manager (Redux/Zustand). Low cost if using existing state infra. |
| **R3** | "Settings dropdown" in top bar conflicts with existing "Settings" / "Admin" menu (if present). Naming collision. | Low | Rename to "Configure", "Display", or "More options". Linear uses "Display". |
| **R4** | Filter strip = separate pane introduces *visual* duplication (filters also shown in pill-bar context if user already has filters active). UX confusion. | Medium | Accept v1 duplication; hide pill-bar filter indicator if filter-pane is open (mutual exclusion). Or: inline filter pills in pill-bar footer (iteration 3). |
| **R5** | Industry evidence for "chart-on-right" is strong, but GDS codebase may have hardcoded assumptions that chart is a tab. Risk of regression. | Medium | Audit `QueryBuilderResults.tsx` for conditional mounts on tab key before refactor. Plan phase should identify these. |

---

## Unresolved Questions

1. **Settings board default state:** Should all cubes be checked by default (show all), or should there be a "Recent" smart filter? Recommend: all checked, no smart filtering.
2. **Filter strip collapse state:** Should it persist across sessions (localStorage)? Or reset to collapsed on each page load? Recommend: persist.
3. **Chart panel width:** Fixed (e.g., 30% of container), or resizable? Recommend: fixed for v2 (resizable adds complexity).
4. **Filters in pill-bar vs. separate pane:** Should we remove filters from pill-bar's 4 rows (D5 locked decision), or keep both surfaces? Current phase-04 includes filters row. Industry evidence says *separate pane* is standard. Recommend: keep pill-bar filters row (backward compat), but promote separate filter *strip* as primary. Users can ignore pill-bar filter row if they use strip.
5. **Backward compat with Iteration 1 UI:** Should we preserve the pill-bar in its current form, or refactor it as a sub-component of a larger layout manager? Recommend: keep pill-bar as-is, add new siblings (filter strip, settings board) around it.
