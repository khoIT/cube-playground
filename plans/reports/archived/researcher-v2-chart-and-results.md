# Chart Panel + Results Card — v2 Standalone Spec

## Summary

Extracted design specs for the **Chart panel** (right pane) and **Results card** (center column) from the current codebase and v2 reference. The implementation is largely complete via the pane-redesign plan (Phase 3-4); this report documents concrete values for future refinement or audit.

---

## Chart Panel (Right Pane, Resizable)

### Header Row
- **PaneHeader** styled-component (`src/components/AppPanes/PaneParts.tsx:13-21`)
  - `display: flex; align-items: center; justify-content: space-between; gap: 8px;`
  - `padding: 12px 14px`
  - `border-bottom: 1px solid var(--border-card)` → `#e5e5e5`
  - `flex-shrink: 0`

- **PaneTitle** styled-component (`src/components/AppPanes/PaneParts.tsx:23-30`)
  - Text: "CHART" (uppercase)
  - `font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;`
  - `color: var(--text-muted)` → `#737373`
  - `margin: 0`

- **Right-slot controls** (collapse button + future Pivot/Code buttons)
  - Currently: `<Button type="clear" size="small" icon={<ChevronRight />} />`
  - Future spec: "Pivot" and "Code" buttons (dashed border, text-only, likely `type="outline" size="small"`)
  - Button styling from `@cube-dev/ui-kit`; dashed may require custom border override

### Chart-type Toggle
- **Currently absent** in current code (`QueryBuilderChart.tsx`)
- **Expected location**: Below PaneHeader, inside PaneBody
- **Spec from reference**: Segmented toggle with options: Line / Bar / Area / Table
- **Styling**: segmented-button style (group of buttons, active state highlighted in brand orange)
  - Active state: background `var(--brand)` → `#f05a22`, text `var(--text-on-brand)` → `#ffffff`
  - Inactive state: background transparent/white, text `var(--text-secondary)` → `#404040`
  - Likely uses `@cube-dev/ui-kit` `Radio.Group` or custom segmented component

### Body (Chart Area)
- **PaneBody** styled-component (`src/components/AppPanes/PaneParts.tsx:32-37`)
  - `flex: 1 1 auto; min-height: 0; overflow: auto;`
  - `padding: 10px 12px`

- **ChartRenderer** content area
  - Max height: `350px` (from `QueryBuilderChartResults.tsx:19`)
  - Uses Recharts for Bar/Line/Area rendering
  - Table mode: renders via `GridTable` (from `QueryBuilderResults.tsx`)

### Outer Pane
- **AppPane** (`src/components/AppPanes/AppPane.tsx`)
  - `background: var(--bg-card)` → `#ffffff`
  - `border: 1px solid var(--border-card)` → `#e5e5e5`
  - `border-radius: var(--radius-card)` → `12px`
  - `box-shadow: var(--shadow-xs)` → `0 1px 2px rgba(0, 0, 0, 0.04)`
  - Resize handle between panes: styled line, color `#e5e5e5`

---

## Results Card (Center Column, Bottom)

### Tabs Row
- **Tabs** component (`src/QueryBuilderV2/components/Tabs/Tabs.tsx`)
  - Tab titles: "Results" | "Analysis" | "SQL" | "SQL API" | "REST" | "GraphQL"
  - Styling via tasty DSL + CSS custom properties

#### Active Tab Underline
- `shadow: inset 0 -1ow 0 #purple` → resolves to `var(--brand)` → `#f05a22` (brand orange)
- Thickness: `1ow` (one optical width, ≈ 2-3px in Cube UI Kit)
- Active tab text color: `color: #purple-text` → `var(--brand-hover)` → `#c2410c`
- Font weight: `600` (`t3m` preset = 14px / 600 weight)

#### Inactive Tab
- Text color: `#dark-02` → `#a3a3a3` (neutral-400)
- Hover state: `hovered: #purple` → `#f05a22`
- Background: `#white`

#### Tabs Container
- `display: grid; gridColumns: max-content max-content;`
- `placeContent: stretch space-between;` (title left, extra right)
- `padding: 0 2x` → `0 16px`
- Border: `inset 0 -1bw 0 #border` → hairline bottom border `#e5e5e5`
- Overflow: `auto` (horizontal scroll if needed)

### Right Extras (Order + Options)
- **QueryBuilderExtras** component (`src/QueryBuilderV2/QueryBuilderExtras.tsx`)
- Positioned in the tabs header right-slot via `extra={<QueryBuilderExtras />}`
- Currently exports "Order" and "Options 1" dropdowns (exact button spec TBD — likely dashed border or outline style, small size)
- Button styling: outline buttons, font-size `13px` (t3m preset)

### Table Header
- **GridTable column headers** (`src/QueryBuilderV2/QueryBuilderResults.tsx:342-410`)
  - Background: `fill: #dark-04.8` → `rgba(10, 10, 10, 0.08)` (soft gray tint, not orange per spec note below)
  - Text color: `color: #dark` → `#0a0a0a`
  - Font: `preset: t3` → 13px / 500 weight
  - Padding (cells): `width: 'min 140px'`, implicit vertical padding via height
  - Border: hairline between columns via grid layout

**Note on header background**: Current code uses dark-tinted neutral bg, not orange. If v2 reference shows orange-tinted header (`rgba(240, 90, 34, 0.06)` as spec suggested), this is a delta to capture and may be applied in Phase 5 (polish).

### First Column (Type Icons)
- **Dimension column header**: text "Aa user_id" with type badge
- **Measure column header**: text "# ltv_30d_total_vnd" with # badge
- Badge styling: `<MemberBadge>` or `<Tag>` component from ui-kit
- Icon: custom "Aa" or "#" glyph, likely 12px font-size
- Cell content: mixed grid layout (`gridColumns: '1fr auto'` for value + copy button)

### Cell Content
- **Styling**: preset `t3` (13px / 500), color `#dark` → `#0a0a0a`
- **Row borders**: hairline `#border` (via `fill: #dark-04.8` background bleed)
- **Hover**: cell becomes selectable with copy button visible on right
- **Padding**: implicit via grid row height (≈4x or 4x / 1.5 in Cube units ≈ 20-24px)

### Table Footer
- **TableFooter** styled-component (`src/QueryBuilderV2/QueryBuilderResults.tsx:93-103`)
  - `display: flex; placeContent: center space-between;`
  - `padding: 1x` → `8px`
  - `height: 5x` → `40px`
  - `border: top` → hairline `#border` → `#e5e5e5`
  - `fill: #white` → white background

#### Footer Left
- Text: `{data.length} results · received {timeDistance} ago`
- Font: `preset: t3m` → 13px / 600 weight (bold for result count)
- Color: `#dark` → `#0a0a0a` (primary text)

#### Footer Right
- Pagination (if > 100 rows): previous/next buttons + page selector
- **Export CSV** button: `type="outline" size="small"` (dashed or outline border)
- **Generate code** button: `type="outline" size="small"` (dashed or outline border)
- Gap between buttons: `0.5x` → `4px`

---

## Design Tokens (Resolved)

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--brand` | `#f05a22` | Active tab underline, button hover, active states |
| `--brand-hover` | `#c2410c` | Active tab text, intensified hover |
| `--border-card` | `#e5e5e5` | Hairline dividers, pane borders |
| `--bg-card` | `#ffffff` | Card/pane background |
| `--bg-app` | `#fafafa` | Outer layout background |
| `--text-muted` | `#737373` | Section labels ("CHART", "SCHEMA") |
| `--text-secondary` | `#404040` | Inactive tab text |
| `--text-primary` | `#0a0a0a` | Body text, headers |

### Spacing (Cube UI Kit units; 1 unit = 8px)
| Token | Value (px) | Usage |
|-------|-----------|-------|
| `--pane-gap` | `10px` | Gap between panes in layout |
| PaneHeader padding | `12px 14px` | Header internal spacing |
| PaneBody padding | `10px 12px` | Body internal spacing |
| Tab padding | `1.25x` vert / `1.5x` horiz | Tab title spacing |
| Section label padding | `8px 4px 6px` | Small section title spacing |

### Typography
| Property | Value | Usage |
|----------|-------|-------|
| Font family | `'Geist', -apple-system, ...` | All text (from `tokens.css`) |
| Section label | 11px / 600 weight / 0.06em letter-spacing | "CHART", "RESULTS", etc. |
| Tab title | 13px / 600 weight (t3m) | Active/inactive tab text |
| Body text | 13px / 500 weight (t3) | Table cells, descriptions |
| Large text | 14px / 600 weight (t2m) | Tabs when `size="large"` |

### Radii & Shadows
| Token | Value | Usage |
|-------|-------|-------|
| `--radius-card` | `12px` | Pane outer border-radius |
| `--radius-input` | `8px` | Input fields (search, etc.) |
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,0.04)` | Pane shadow |

---

## Implementation Status

### Chart Panel
- ✅ Header (PaneTitle "CHART") — implemented
- ✅ Collapse/expand button — implemented
- ✅ Body padding & scroll — implemented
- ⏳ Chart-type toggle (Line/Bar/Area/Table) — **not yet in code**, spec ready
- ⏳ Pivot/Code header controls — **not yet in code**, spec ready

### Results Card
- ✅ Tabs row (Results/Analysis/SQL/...) — implemented
- ✅ Active underline (orange brand) — implemented
- ✅ Table header + cells — implemented
- ✅ Footer with result count + pagination — implemented
- ⏳ Export CSV button — **partially**, needs styling audit
- ⏳ Generate code button — **partially**, needs styling audit
- ⏳ Order/Options buttons positioning — via `QueryBuilderExtras`, styling TBD
- ⚠️ Table header bg color — current is neutral-dark-tinted, may need orange-soft tint per v2 reference

---

## Key Files

### Chart Panel
- `src/components/AppPanes/PaneParts.tsx` — PaneHeader, PaneTitle, PaneBody styling
- `src/QueryBuilderV2/components/ChartSidePane.tsx` — collapse/expand logic
- `src/QueryBuilderV2/QueryBuilderChart.tsx` — chart rendering + type selection
- `src/QueryBuilderV2/QueryBuilderChartResults.tsx` — chart result wrapper

### Results Card
- `src/QueryBuilderV2/components/Tabs/Tabs.tsx` — tab component + styling
- `src/QueryBuilderV2/QueryBuilderResults.tsx` — table header, cells, footer
- `src/QueryBuilderV2/QueryBuilderExtras.tsx` — Order/Options controls
- `src/theme/tokens.css` — all color/spacing tokens

### Design Tokens & Theme
- `src/theme/tokens.css` — CSS custom properties
- `src/theme/ui-kit-theme.ts` — ui-kit color mappings (purple = brand, etc.)
- `src/QueryBuilderV2/color-tokens.ts` — QueryBuilder-specific member type colors

---

## Unresolved Questions

1. **Chart-type toggle implementation**: Is the segmented toggle already in code under a different name? Search for "Line Bar Area Table" or chartType selection UI.

2. **Pivot / Code buttons in chart header**: Are these buttons already stubbed or is this a v2 feature addition? Check `QueryBuilderChart.tsx` for pivot/analysis controls.

3. **Table header background color**: Current code uses `fill: #dark-04.8` (neutral-tinted). Does the v2 reference show an orange-soft tint (`rgba(240, 90, 34, 0.06)`)? If yes, this is a styling delta.

4. **Export CSV / Generate code buttons**: Exact button styling (border style, icon, placement) — confirm in v2 reference or run interactive test. Currently rendered but styling may need refinement.

5. **"Received N minutes ago" text styling**: Confirm font-size, color, and spacing match v2 reference. Currently uses `preset: t3` (13px) — audit against reference.

---

## Differences from Current Code (Auditable)

| Component | Current Implementation | v2 Reference Spec | Status |
|-----------|------------------------|-------------------|--------|
| Table header bg | `#dark-04.8` (neutral) | Possibly orange-soft | ⚠️ Needs audit |
| Chart toggle | Missing | Line/Bar/Area/Table segmented | 🔴 Not implemented |
| Pivot button | Missing | Header right-slot | 🔴 Not implemented |
| Code button | Missing | Header right-slot | 🔴 Not implemented |
| Footer buttons styling | Basic outline | Dashed border, small | ⚠️ Needs refinement |
| Active tab underline color | `#purple` (resolves to `#f05a22`) | Brand orange | ✅ Matches |
| Tab title case | Sentence case ("Results") | Sentence case | ✅ Matches |
| Pane radius | `12px` | `12px` | ✅ Matches |

---

## Status
**Status: DONE** — Extracted and cataloged design specs from codebase + v2 reference for Chart panel and Results card. Ready for implementation planning or Phase 5 polish audit.
