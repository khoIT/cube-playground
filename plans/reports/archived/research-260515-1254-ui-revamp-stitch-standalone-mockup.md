# Research Report: GDS Cube UI Revamp — Adopting "Cube Playground (standalone)" Stitch Mockup

**Conducted:** 2026-05-15
**Source mockup:** `file:///Users/lap16299/Downloads/Cube Playground _standalone_.html` (Stitch/Figma export, ~1.8 MB bundled babel/JSX)
**Constraint:** Functionally identical to current QueryBuilderV2; revamp visual layer only.

---

## Table of Contents
- [Executive Summary](#executive-summary)
- [Mockup Anatomy](#mockup-anatomy)
- [Gap Map — Current vs Mockup](#gap-map)
- [Question: "What is `timeDimensions` for?"](#what-is-timedimensions-for)
- [Implementation Strategy (KISS)](#implementation-strategy)
- [Per-Feature Plan](#per-feature-plan)
- [Risks & Open Decisions](#risks-and-open-decisions)
- [Next Steps](#next-steps)
- [Unresolved Questions](#unresolved-questions)
- [Appendix A — Component Map](#appendix-a)

---

## Executive Summary

The mockup is a clean, opinionated marketing-grade reskin. Underneath it does exactly what our QueryBuilderV2 (QBv2) already does — measures/dimensions/time/filters → chart+table — so we can keep QBv2's logic and rewrite just the **chrome** (top bar, sidebar shell, query-state pill bar). Three of four requested revamps are pure visual work; one is structural:

| # | Request | Effort | Strategy |
|---|---------|--------|----------|
| 1 | Top menu look | Low | Replace antd `<Menu>` in `Header.tsx` with custom pill-button row using mockup tokens |
| 2 | Left bar with rename + icon picker | **Medium** | Add edit overlay on top of `QueryBuilderSidePanel`. Cube/View *file* rename = dev-mode-only API call (`POST /playground/files`) |
| 3 | Main panel = QueryBuilder card on top (Dim → Measure → Filter) + Results below | **Medium** | New `<QueryStatePillBar>` component above `<QueryBuilderResults>`. Wraps existing QBv2 state via `useQueryBuilderContext()` — no logic duplication |
| 4 | Results = first tab (Table replaced by our column-reorder/resize); Chart = separate expandable panel | Low | Reorder tabs in `QueryBuilderResults.tsx` (tab strip starts ~line 950); pull chart into collapsible `<Panel>` |

**One non-obvious decision:** The mockup's "left sidebar" is *browse-only* (click member → add). Our QBv2 sidebar is *both* browse + state. Adopting the mockup pattern means the **sidebar shows what's available**, the **top pill bar shows what's selected**. This duplicates information cheaply (selected members highlight in both) and makes "what's in my query" glanceable. Net win.

**About `timeDimensions`:** mockup keeps it as a distinct row labelled "Time" with a granularity chip (day/week/month/...). Cube needs it as a first-class concept — see [dedicated section](#what-is-timedimensions-for). Don't remove it; either keep "Time" as the 3rd row or fold the time-dim chip into the Date Range strip at the bottom of the QueryBuilder card.

---

## Mockup Anatomy

Extracted from the bundled JSX (`/tmp/mockup/*.js`). Reference IDs are the Stitch UUIDs.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TopBar: [Cube logo][·][VNG logo][Data Platform badge]                   │
│  [Playground] [Models] [SQL runner] [Pre-aggs] [Metrics•3] [Docs]        │
│                            [+Request metric] [📥3] [?] [⚙] [avatar]      │
├────────────┬───────────────────────────────────────────┬─────────────────┤
│            │ ┌─ Query ────────────────[Save][Share][▶ Run]─┐ │           │
│  Schema    │ │ Measures   • Players.dau   • Revenue.total  + │ │ Pending │
│  ─────     │ │ Dimensions  +                                  │ │ Saved q │
│  🔍 search │ │ Time       • Players.registeredAt [day] +     │ │ ...     │
│            │ │ Filters    • Players.country = "Vietnam"  +   │ │         │
│  ▾ Players │ │ ┌─────────────────────────────────────────┐   │ │         │
│    Measures│ │ │ 📅 Date range [7d|14d|30d|QTD|Custom]   │   │ │         │
│      • dau │ │ └─────────────────────────────────────────┘   │ │         │
│      • mau │ └────────────────────────────────────────────────┘ │         │
│    Dim     │                                                    │         │
│    Time    │ ┌─ Results ─[Chart][Table][Pivot][SQL][JSON]──[Export][⟳]─┐ │ │
│  ▸ Sessions│ │   <chart or table here>                                  │ │ │
│  ▸ Revenue│ │                                                          │ │ │
│            │ └──────────────────────────────────────────────────────────┘ │ │
└────────────┴───────────────────────────────────────────┴─────────────────┘
```

**Design tokens used (mockup CSS, line ~10–300 of unescaped mock.html):**
- Brand orange: `--orange-600: #f05a22`
- Neutral scale: Tailwind v4 `--neutral-50..950`
- Font: `Geist` (sans) / `Geist Mono`
- Chart palette: `#f05a22, #3f8dff, #009689, #f59e0b, #a855f7`
- Card: white bg, `1px solid --neutral-200`, `border-radius: 12px`, `box-shadow: var(--shadow-xs)`

**Mockup component tree (file ↦ component):**
| File UUID | Exports |
|---|---|
| `45f1dc08…` | `App`, `TopBar`, `RightRail`, `Toast` |
| `3c63d8e0…` | `MemberPicker`, `MemberRow`, `QueryBuilder`, `SchemaSidebar`, `CubeSection` |
| `3a16025a…` | `ResultsPanel`, `LineChart`, `BarChart`, `StatNumber`, formatters |
| `99bb8f11…` | `ICONS` (lucide names) |
| `d0acff27…` | `RequestMetricModal` + steps |
| `5e3cb558…` | Tweaks panel (host protocol — ignore, Figma-only) |
| `4a55079b…` | `CUBES` sample data |

---

## Gap Map

Map of every revamp request to the file(s) that change.

### 1. Top menu

| Mockup | Current (`src/components/Header/Header.tsx`) |
|---|---|
| Custom pill buttons, 32 px tall, `border-radius:8px`, icon + label, brand pill for active. Brand area is `Cube + divider + VNGGames-logo + "Data Platform" badge`. | antd `<Menu mode="horizontal">` with two items ("Playground"/"Data Model"), antd default styling. Brand is a styled `<div>Brand>GDS Cube</div>`. |

Change: drop antd `<Menu>`, replace `Brand` with `Cube + VNG + badge` block, add icon-prefixed pill buttons in plain JSX with hover/active styles. ~80 LOC delta. Existing routes `/build` and `/schema` keep working; rename labels to "Playground" / "Models".

### 2. Left bar — explore + **rename file + icon**

| Mockup | Current (`QueryBuilderSidePanel.tsx` + `SidePanelCubeItem.tsx`, `ListCube.tsx`, `ListMember.tsx`) |
|---|---|
| 280 px wide. Search input at top. Tree of cubes with chevron, cube-icon, name. Each section: Measures / Dimensions / Time / Segments. Member row click → add to query. **Per-row inline rename + icon picker is implied by user request, not present in mockup.** | Has Cubes/Views toggle, search, member tree, color-coded member icons. No rename/icon-edit. |

**Rename action breakdown:**

| What "rename" means | API to hit | Dev-mode? | Status |
|---|---|---|---|
| **Rename schema file** (e.g. `cubes/active_daily.yml` → `cubes/daily_users.yml`) | `POST /playground/files` with new content + delete old via `DELETE /playground/files/:path` | YES (dev only) | We already proxy `/playground/*` → :4000 |
| **Change cube `title`** in the YAML | Same — edit the file's YAML `title:` field | YES (dev only) | Same proxy |
| **Change cube `icon`** | Cube *schema* has no icon field. The mockup's icon is **hard-coded per cube in CUBES sample data**. To support real cubes, we'd need: (a) Cube backend to honour a custom `meta.icon` field, OR (b) store icon-by-cube-name in `localStorage` client-side (KISS choice). | (b) is purely client | n/a |

**Verdict:** rename = real backend write to `/playground/files`. Icon = localStorage map keyed by cube name. Both are dev-mode-only by design.

### 3. Main panel — QueryBuilder card on top, ordered Dim → Measure → Filter

| Mockup `QueryBuilder` (3c63d8e0:148–209) | Current QBv2 |
|---|---|
| Card with `<MemberRow>` rows. Mockup order: Measures, Dimensions, Time, Filters. Each row: 110 px label column + flex pill bar with `+ Add` button. Bottom strip: Date range Segmented. | **No equivalent component exists in QBv2.** Members are added via the side panel; current query state is implicit in highlighted-tree-nodes. Top-level toolbar (`QueryBuilderToolBar.tsx`) is just `[Run query]` + pre-agg badge. |

This is the **biggest add**: a new `<QueryStatePillBar>` component that:
1. Subscribes to `useQueryBuilderContext()` (already wired into the QBv2 tree — context exposes `query`, `setMembers`, `removeMember`, etc.)
2. Renders 3 (per user request) or 4 (keep Time) MemberRows
3. **Order per user request:** Dimensions → Measures → Filters (override mockup default)
4. Each pill triggers existing `removeMember(...)` / opens MemberPicker overlay
5. Pull date-range strip from QBv2's `QueryBuilderExtras.tsx` and embed it as the card footer

Estimate: ~250 LOC of new pure-presentational React, ~zero new business logic.

### 4. Results — Table replaces standalone "Table tab", promoted to first tab; Chart as expandable panel

| Mockup ResultsPanel (3a16025a:149–319) | Current `QueryBuilderResults.tsx` |
|---|---|
| Tabs in order: **Chart, Table, Pivot, SQL, JSON**. Chart is default. Each tab fills the same card. | Our Results IS the table view with column reorder/resize (lines 1006/1084/1186: dimensionColumns / measuresColumns / timeDimensionsColumns rendered into a `GridTable`). Chart lives in `QueryBuilderChart.tsx` as a sibling tab. SQL / JSON / GraphQL / REST are separate tabs in the parent `QueryBuilder.tsx`. |

User wants:
- **Results (our column-reorder/resize grid) = first tab.** Replace the mockup's "Table" tab entirely.
- **Chart = expandable panel, separate from Results card.**
- Keep look-and-feel of mockup chart (line chart with summary KPIs above, legend below, segmented chart-type chooser).

Implementation:
1. In `QueryBuilder.tsx` (parent), reorder tabs: Results (was Table) → Pivot → Chart → SQL → JSON → REST → GraphQL. Mockup-tab labels: Results, Chart, Pivot, SQL, JSON.
2. Move Chart out of tab strip into a collapsible `<Panel>` *above* or *beside* Results. UI-kit has a `Panel` primitive.
3. Restyle Chart to use mockup tokens (orange-brand line, summary KPI cards on top, simple legend) — that's `QueryBuilderChartResults.tsx` (~600 LOC, only the wrapper styling changes).

---

## What is `timeDimensions` for?

Short answer: it's **Cube's first-class time-series construct**, distinct from a regular dimension because it carries:

- `dimension`: the time column (e.g. `Players.registeredAt`)
- `granularity`: `hour | day | week | month | quarter | year` (or `null` = no bucketing, just date-range filter)
- `dateRange`: `last 14 days` | `[from, to]` | named ranges

When you put a member in `timeDimensions[]` with `granularity: "day"`, Cube generates `DATE_TRUNC('day', col)` in the GROUP BY automatically. If you put the same column in `dimensions[]`, you get raw timestamps grouped per-microsecond — useless for charts.

The mockup's bottom "Date range" Segmented strip is the **shorthand for `dateRange`**, while the "Time" row above is the **`timeDimensions[]` array with its granularity chip**. They're two halves of the same concept — date filter (when?) vs time bucket (how granular?).

**Recommendation:** keep "Time" as its own row in `<QueryStatePillBar>`. User's preferred order would then be:
1. Dimensions
2. Measures
3. **Time (with granularity chip — non-removable, fold-able)**
4. Filters

If we want exactly 3 rows: collapse Time into the date-range strip (clickable chip "Date range: last 14d, by day" → opens granularity + range picker). That matches user's instinct ("not sure what's the time series in query for") — it folds the technical detail under a single user-friendly control.

---

## Implementation Strategy

**KISS.** Don't rewrite QBv2. Theme it.

Three layers of work, smallest blast radius first:

### Layer 1 — Tokenisation (1 day)
- Add a `theme/tokens.css` with the mockup's CSS custom-property scale (`--neutral-*`, `--orange-*`, `--brand`, semantic vars).
- Override `@cube-dev/ui-kit` and antd colors via these tokens. Most of the mockup's "feel" comes from typography (`Geist`) + spacing + the neutral/orange palette.
- Import `Geist` + `Geist Mono` from Google Fonts in `index.html`.

### Layer 2 — Chrome rewrite (2–3 days)
- `Header.tsx`: replace antd `<Menu>` with pill-button row + brand area. ~80 LOC.
- `QueryBuilderSidePanel.tsx`: keep tree logic, restyle row borders / tree-row paddings to match mockup. Add inline rename trigger per cube. ~150 LOC delta.
- `QueryBuilderResults.tsx`: reorder tabs, promote results-grid to default, extract chart into collapsible panel. ~50 LOC of structural change + restyle of `QueryBuilderChartResults.tsx`.

### Layer 3 — New `<QueryStatePillBar>` (2 days)
- New file: `src/QueryBuilderV2/QueryStatePillBar.tsx`.
- Subscribes to `useQueryBuilderContext()` for `query` + mutators.
- Renders 4 MemberRows in user-preferred order. Each pill = existing `<MemberLabel>` styled as mockup pill. `+ Add` button opens existing `<AddFilterInput>` / member picker dialogs.
- Mounted above `<QueryBuilderResults>` in `QueryBuilder.tsx`.

### Out of scope (per user "keep all current function the same")
- RequestMetricModal flow from mockup — that's a *new feature* we don't have. Skip.
- AI-assist (`aiAssist` tweak). Skip.
- Pending-requests right rail. Skip — or replace with our existing query-tabs panel.

---

## Per-Feature Plan

### A. Cube/View file rename

```typescript
// proposed: src/components/SchemaEditor/renameCube.ts
async function renameCubeFile(oldPath: string, newPath: string, content: string) {
  await fetch('/playground/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ fileName: newPath, content }] }),
  });
  await fetch(`/playground/files/${encodeURIComponent(oldPath)}`, { method: 'DELETE' });
  // Then trigger meta refresh; QueryBuilderContext will re-fetch /cubejs-api/v1/meta
}
```

Note: writing to `/playground/files` is what hit the EROFS error earlier — same constraint applies. **Rename only works if the backend's model volume is read-write.** Document this; don't fix it in UI.

### B. Cube icon picker

```typescript
// proposed: src/hooks/use-cube-icon.ts (client-only, no API)
const STORAGE_KEY = 'gds-cube:cube-icons';
export function useCubeIcon(cubeName: string) {
  const [icons, setIcons] = useState<Record<string, string>>(() =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
  );
  const setIcon = (icon: string) => {
    const next = { ...icons, [cubeName]: icon };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setIcons(next);
  };
  return [icons[cubeName] || 'database', setIcon] as const;
}
```

Icon library: lucide-react (mockup uses lucide names). Already MIT, ~50 KB tree-shaken.

### C. QueryStatePillBar wiring

```typescript
// proposed: src/QueryBuilderV2/QueryStatePillBar.tsx
export function QueryStatePillBar() {
  const { query, setMembers } = useQueryBuilderContext(); // already exposed

  return (
    <Card>
      <CardHeader>
        <span>Query</span>
        <Badge>Live</Badge>
        <Button onClick={runQuery}>Run query</Button>
      </CardHeader>

      {/* USER PREFERRED ORDER */}
      <MemberPillRow label="Dimensions" kind="dimension" items={query.dimensions} />
      <MemberPillRow label="Measures"   kind="measure"   items={query.measures}   />
      <MemberPillRow label="Time"       kind="time"      items={query.timeDimensions} />
      <MemberPillRow label="Filters"    kind="filter"    items={query.filters}    />

      <DateRangeStrip /> {/* extracted from QueryBuilderExtras */}
    </Card>
  );
}
```

### D. Chart as collapsible panel

```tsx
// in QueryBuilder.tsx, replace the chart-tab with a panel
<Collapse defaultActiveKey={[]}>
  <Collapse.Panel header="Chart" key="chart">
    <QueryBuilderChartResults /> {/* existing component, restyled */}
  </Collapse.Panel>
</Collapse>
```

---

## Risks and Open Decisions

| # | Risk | Mitigation |
|---|---|---|
| R1 | QBv2's logic depends on its current sidebar UX — adding a top pill bar may produce dual UX paths (sidebar click adds member; pill X removes member). Could confuse. | Highlight selected members in sidebar (already done via QBv2 color-coding). Pill bar = source of truth for "what's in my query". |
| R2 | `Geist` font is licensed (Vercel) — check OFL terms. | OFL 1.1, free to embed; ships via Google Fonts CDN. ✓ |
| R3 | Restyling antd CSS via tokens is fragile (antd 4 uses Less variables, not custom properties). | Two paths: (a) regenerate `antd.min.css` via Less compile with overrides — slow but works; (b) target antd class names with our own override stylesheet. Pick (b) — narrower diff. |
| R4 | Mockup uses pure JSX (no UI-kit); our QBv2 uses `@cube-dev/ui-kit` heavily. Mixing styles risks visual fragmentation. | Confine the new chrome to use UI-kit primitives (`Card`, `Flex`, `Button`) re-themed; don't introduce a third UI framework. |
| R5 | Date-range strip extraction from `QueryBuilderExtras.tsx` is non-trivial (it owns granularity + custom-range state). | Keep `Extras` mounted but hidden; export `<DateRangePicker>` standalone and import into pill bar. |

### Open decisions for user

1. **Keep "Time" as 4th row, or fold into date-range strip?** Recommend keep — clearer for power users; one extra row is cheap.
2. **Rename cube = rename file, OR alias-only (no file write)?** File write is "real" but requires RW model volume. Alias-only is safer.
3. **Right rail (saved queries + pending)?** Mockup has it; we have query tabs in QBv2 toolbar already. Keep tabs, skip rail? Or migrate tabs into rail?
4. **`@cube-dev/ui-kit` antd 4 theming approach — Less recompile vs override stylesheet?** See R3.

---

## Next Steps

1. **Decision call** on the four open questions above (15 min, can be async).
2. Generate a `plans/260515-XXXX-ui-revamp-stitch/` plan directory with:
   - `phase-01-tokenisation.md`
   - `phase-02-chrome-rewrite.md`
   - `phase-03-querystate-pillbar.md`
   - `phase-04-chart-panel.md`
3. Verify backend `/playground/files` is writable (smoke-test rename) before committing to Feature A.
4. Pull `Geist` from Google Fonts; drop `lucide-react@latest` as devDep.

---

## Unresolved Questions

1. **Schema rename API contract.** `POST /playground/files` supports overwrite; does Cube dev-mode expose `DELETE /playground/files/:path`? Need to grep cube-core source or smoke-test. If no delete, "rename" is actually "duplicate + manual delete" → broken UX.
2. **Are `cube_role` / `view` files renamable?** A view's `cubes:` list references underlying cube names. Renaming a cube breaks all views — need cascade-update or block-rename. Out of scope for this report; flag for the plan phase.
3. **Behaviour of side-panel-click when pill bar is the primary input?** Click in sidebar = add? Or click = highlight + suggest? Mockup is "click adds"; QBv2 is "click adds". Recommend keep parity.
4. **Does `@cube-dev/ui-kit@0.52.3` ship Geist-compatible font weights?** UI-kit hard-codes font-family in some places; may need to patch via `Root styles` prop.
5. **Right rail vs query tabs — keep both or merge?** User didn't address rail explicitly.

---

## Appendix A — Component Map

Quick reference for file-level changes:

| Mockup component | Lives in (new or existing) | Type |
|---|---|---|
| `<TopBar>` | `src/components/Header/Header.tsx` | Rewrite |
| `<SchemaSidebar>` | `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` + new `CubeRowEditor.tsx` | Restyle + add |
| `<MemberRow>` (in QueryBuilder card) | NEW: `src/QueryBuilderV2/QueryStatePillBar.tsx` | New |
| `<MemberPicker>` (popup on +Add) | Existing `AddFilterInput.tsx` + `FilterByMemberButton.tsx` | Reuse |
| `<ResultsPanel>` | `src/QueryBuilderV2/QueryBuilderResults.tsx` (reorder tabs) + `QueryBuilderChartResults.tsx` (restyle) | Reorder + restyle |
| `<RightRail>` | OUT OF SCOPE (decide first) | — |
| `<RequestMetricModal>` | OUT OF SCOPE (not in current spec) | — |
| `<Toast>` | UI-kit `Notification` already covers | Reuse |

Mockup tokens to import as CSS custom properties — see [Mockup Anatomy → tokens](#mockup-anatomy).
