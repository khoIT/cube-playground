---
phase: 3
title: "Detail Drawer"
status: pending
priority: P2
effort: "1-2d"
dependencies: [1, 2]
---

# Phase 3: Detail Drawer

## Context Links

- Brainstorm: [../reports/metadata-catalog-tab-system-meta.md](../reports/metadata-catalog-tab-system-meta.md) (DetailDrawer section — DA-building-metrics bonuses)
- P1/P2 outputs: card grid + filter state

## Overview

Click a card → slide-in drawer with full member list, per-measure SQL snippet, sibling-of-same-type strip, joinable-cube chips, and an "Open in Playground" deep-link. This is the phase that turns the catalog from "list" into a duplication-prevention surface.

## Priority

P2 — depends on P1 + P2; biggest UX payoff for the DA persona.

## Requirements

### Functional
- Card click opens a right-side slide-in drawer (50% viewport width, max 800px).
- Drawer shows:
  - Header: cube name, title, type badge, owner chip, close button.
  - Description block (full text, not truncated).
  - Tabs: **Members** (default), **Joins**, **Raw JSON**.
- **Members tab:**
  - Grouped sections: Measures, Dimensions, Segments.
  - Each row: name, title, type icon, description (one line), aggregation type (measures only), `meta.*` chips.
  - Per-measure: expandable SQL snippet (collapsed by default, monospace, copy button).
  - Per-measure: "Sibling strip" — small inline note "N other `<type>` measures here" with a click-to-scroll affordance.
- **Joins tab:** chip-list of joinable cubes; click a chip swaps drawer to that cube (drawer stack with back button).
- **Raw JSON tab:** prettified, syntax-highlighted (reuse existing `PrismCode`), copy button.
- **Open in Playground** button (header right):
  - Builds a Cube query JSON with first measure of the cube pre-seeded.
  - Opens `/#/build?query=<urlencoded JSON>` in a new tab.
  - If cube or first measure is `public: false`, shows tooltip "Hidden under your JWT — query may fail" but still enables the link.

### Non-functional
- Drawer open/close animation < 200ms.
- Drawer keyboard-accessible (Esc to close, Tab order sane).
- SQL syntax highlighting reuses Prism (already in repo via `PrismCode`).

## Key Insights

- "Open in Playground" link format already exists — `/playground?query=<JSON>` is the documented contract (README:47). Hash router means actual URL is `/#/build?query=…`.
- Sibling-strip and joinable-chips are the discovery-surface differentiator. Without them this is just a fancy `/meta` viewer.
- `@cube-dev/ui-kit` likely has a Dialog/Drawer primitive (`tasty(Dialog)` or similar). Check it before rolling a custom one.

## Architecture

```
<CubeCard onOpenDetail={setDrawerCube} />
       │
       ▼
<DetailDrawer cube={drawerCube} onClose={...} stack={drawerStack}>
  ├─ Header (name, type, owner, Open-in-Playground btn, close)
  ├─ Description
  └─ Tabs
      ├─ Members
      │   ├─ MeasureRow
      │   │   ├─ name + type + meta chips
      │   │   ├─ Sibling strip ("3 other countDistinct measures")
      │   │   └─ <SqlSnippet sql={measure.sql} />  (collapsed)
      │   ├─ DimensionRow
      │   └─ SegmentRow
      ├─ Joins
      │   └─ JoinChip × N  (onClick → push to drawerStack)
      └─ RawJson
          └─ <PrismCode language="json" />
```

Drawer stack is a `useState<Cube[]>([])`; opening a join pushes; close pops.

## Related Code Files

**Create:**
- `src/pages/Metadata/detail-drawer.tsx` — drawer container, stack management
- `src/pages/Metadata/drawer-header.tsx` — title bar with Open-in-Playground button
- `src/pages/Metadata/members-tab.tsx` — measures + dimensions + segments groups
- `src/pages/Metadata/measure-row.tsx` — name + chips + sibling strip + SQL collapse
- `src/pages/Metadata/dimension-row.tsx` — name + chips (no SQL for v1)
- `src/pages/Metadata/sql-snippet.tsx` — collapsible monospace block with copy button
- `src/pages/Metadata/joins-tab.tsx` — chip list of joinable cubes
- `src/pages/Metadata/raw-json-tab.tsx` — wraps `PrismCode`
- `src/pages/Metadata/build-playground-deep-link.ts` — pure helper: cube → query JSON → `/#/build?query=…` URL

**Modify:**
- `src/pages/Metadata/cube-card.tsx` — accept `onOpen` callback; whole card clickable
- `src/pages/Metadata/MetadataPage.tsx` — own `drawerStack` state; render `<DetailDrawer />` when non-empty

## Implementation Steps

1. **`build-playground-deep-link.ts`:** pure function. Given `cube`, pick first non-hidden measure; build minimal Cube `Query` `{ measures: [`${cube.name}.${measure.name}`] }`; URL-encode; return `/#/build?query=…`. Handle no-measure case (button disabled).
2. **`sql-snippet.tsx`:** styled `<details><summary>SQL</summary><pre><code>{sql}</code></pre></details>` with a copy button. Use existing `CopyButton` from `src/QueryBuilderV2/components/CopyButton.tsx`.
3. **`measure-row.tsx`:** renders measure name + aggregation type badge + `meta.*` chips + description. Below: SQL snippet (collapsed). Sibling strip computed from parent cube's measure list filtered by `type === measure.type` (excluding self).
4. **`dimension-row.tsx`:** name + type icon + chips + description. No SQL panel for v1 (dimension SQL is often less informative; defer).
5. **`members-tab.tsx`:** three sections with sticky subheaders (Measures / Dimensions / Segments); maps to row components.
6. **`joins-tab.tsx`:** parse `cube.joins`; render chip per join target; chip `onClick` → `onPushDrawer(targetCubeName)`.
7. **`raw-json-tab.tsx`:** wraps `PrismCode language="json" code={JSON.stringify(cube, null, 2)}`.
8. **`drawer-header.tsx`:** title + type + owner chip + Open-in-Playground button (anchor, target=`_blank`) + close. If drawer stack > 1, show back button.
9. **`detail-drawer.tsx`:**
   - Slide-in panel (use `@cube-dev/ui-kit` Dialog/Modal in side-mode if available; else styled-components panel with backdrop).
   - Owns local Tabs state (default Members).
   - Receives `cubeStack: Cube[]` from page; shows `cubeStack[cubeStack.length - 1]`.
   - Esc-to-close handler.
10. **Update `cube-card.tsx`:** wrap card content in a clickable area calling `onOpen(cube)`. Keep accessibility (button role, focus outline).
11. **Update `MetadataPage.tsx`:** `const [stack, setStack] = useState<Cube[]>([])`; render drawer when `stack.length > 0`; pass `onPushDrawer` (resolves cube name → cube from cached data).
12. **Smoke test:**
    - Click card → drawer slides in.
    - Click a measure SQL → expands.
    - Click a joinable-cube chip → drawer switches.
    - Click back → returns to first cube.
    - Click Open-in-Playground → new tab opens `/build` with that measure pre-seeded.
    - Esc closes drawer.

## Todo List

- [ ] Build `build-playground-deep-link.ts` helper
- [ ] Build `sql-snippet.tsx` with copy
- [ ] Build `measure-row.tsx` (with sibling strip)
- [ ] Build `dimension-row.tsx`
- [ ] Build `members-tab.tsx`
- [ ] Build `joins-tab.tsx`
- [ ] Build `raw-json-tab.tsx`
- [ ] Build `drawer-header.tsx` (with back button when stacked)
- [ ] Build `detail-drawer.tsx` (slide-in + stack management)
- [ ] Wire cube-card → drawer open
- [ ] Wire MetadataPage drawer stack state
- [ ] Smoke test full flow including drawer navigation and deep-link

## Success Criteria

- [ ] Clicking any card opens the drawer with full content.
- [ ] Per-measure SQL expands inline; copy button writes to clipboard.
- [ ] Sibling strip correctly shows "N other `<type>` measures" for each measure.
- [ ] Clicking a joinable chip swaps drawer to that cube; back button returns.
- [ ] Open-in-Playground link opens `/#/build` with the first measure seeded; query runs successfully for public measures.
- [ ] Hidden-member warning tooltip shows for `public: false` cubes.
- [ ] Esc closes drawer; keyboard tab order sensible.

## Risk Assessment

- **Cube SQL may be complex / multi-line / templated.** Risk: raw `sql` field could contain unresolved `${CUBE}` templates that look broken. Mitigation: show as-is with a small "raw template" note; resolution would require Cube to expand server-side.
- **Drawer-stack UX confusion.** Risk: deep stack of pushed cubes can lose context. Mitigation: cap stack at 5; back-button always visible; consider breadcrumbs if testers complain.
- **Open-in-Playground for views.** Risk: the chosen "first measure" might not be queryable in isolation if the view requires a join filter. Mitigation: leave the button enabled; failures surface in Playground itself with normal Cube error UI.

## Security Considerations

- Deep-link to Playground uses end-user JWT (not the system secret). Hidden members will fail there — surfaced by tooltip per requirement.

## Next Steps

P4 finishes loading/error polish, adds the PROD guard, refresh button, and docs.
