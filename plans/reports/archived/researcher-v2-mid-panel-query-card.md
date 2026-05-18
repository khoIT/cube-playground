# Query Card + Run Row — v2 Standalone Spec

## Summary
Extracted CSS design tokens and component specs from Cube Playground v2 standalone HTML (~1.8MB minified). Report captures colors, typography, spacing, borders, shadows, and component-specific styling for the query card, pills, run row, and pre-aggregation alert.

**Key constraint:** The standalone file is heavily minified. CSS is readable; JSX/HTML structure is obfuscated. Specific HTML markup for run button and query card wrapper are not easily extractable but CSS classes are well-defined.

---

## CSS Custom Properties (`:root`)

### Raw Color Scale (Tailwind v4)
- **Neutral scale:** `--neutral-50: #fafafa` → `--neutral-950: #0a0a0a` (11 steps)
- **Brand orange (VNGGames):** 
  - `--orange-600: #f05a22` (core brand)
  - `--orange-700: #f54a00` (pressed)
- **Chart palette:**
  - `--chart-1: #f05a22` (orange, primary)
  - `--chart-2: #3f8dff` (blue)
  - `--chart-3: #009689` (teal)
  - `--chart-4: #f59e0b` (amber)
  - `--chart-5: #a855f7` (purple)
- **Info colors:**
  - `--blue-600: #3f8dff`
  - `--emerald-600: #059669`
  - `--red-600: #dc2626`
  - `--amber-500: #f59e0b`

### Semantic Tokens
- `--primary: var(--orange-600)` (VNGGames orange, CTAs)
- `--primary-foreground: #ffffff`
- `--primary-hover: var(--orange-700)`
- `--brand: var(--neutral-900)` (dark neutral, secondary actions)
- `--brand-foreground: var(--neutral-50)`
- `--destructive: var(--red-600)`
- `--success: var(--emerald-600)`
- `--warning: var(--amber-500)`
- `--card: #ffffff`
- `--background: var(--neutral-50)`
- `--border: var(--neutral-200)`
- `--muted-foreground: var(--neutral-500)`

### Radii
- `--radius-xs: 4px`
- `--radius-sm: 6px`
- `--radius-md: 8px`
- `--radius-lg: 10px`
- `--radius-xl: 12px`
- `--radius-2xl: 16px`
- `--radius-full: 9999px`

### Shadows
- `--shadow-xs: 0 1px 2px 0 rgba(0,0,0,0.05)`
- `--shadow-sm: 0 1px 2px -1px rgba(0,0,0,0.1), 0 1px 3px 0 rgba(0,0,0,0.1)`
- `--shadow-md: 0 2px 4px -2px rgba(0,0,0,0.1), 0 4px 6px -1px rgba(0,0,0,0.1)`
- `--shadow-lg: 0 4px 6px -4px rgba(0,0,0,0.1), 0 10px 15px -3px rgba(0,0,0,0.1)`
- `--shadow-xl: 0 8px 10px -6px rgba(0,0,0,0.1), 0 20px 25px -5px rgba(0,0,0,0.1)`

### Typography
- `--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- `--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- `--fw-regular: 400`
- `--fw-medium: 500`
- `--fw-semibold: 600`
- `--fw-bold: 700`

### Spacing Scale (Tailwind)
- `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`
- `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`

---

## Query Row Structure (`.qrow` + `.qrow-label` + `.qrow-content`)

```css
.qrow {
  display: grid;
  grid-template-columns: 88px 1fr;  /* fixed label column, flexible content */
  gap: 14px;
  align-items: start;
  padding: 10px 0;
  border-bottom: 1px dashed var(--neutral-100);  /* #f5f5f5 */
}
.qrow:last-child { border-bottom: 0; }

.qrow-label {
  font-family: Geist;
  font-size: 10.5px;
  font-weight: 600;  /* --fw-semibold */
  color: var(--neutral-500);
  letter-spacing: 0.08em;  /* 0.8% uppercase squish */
  text-transform: uppercase;
  padding-top: 6px;
}

.qrow-content {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 30px;
}
```

**Used for:** DIMENSIONS, MEASURES, TIME, FILTERS rows. Labels: 88px fixed width. Content: flexible row with pill wrapping.

---

## Member Pill (`.m-pill`)

```css
.m-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px 0 6px;  /* asymmetric: left 6px, right 8px */
  background: #fff;
  border: 1px solid var(--neutral-200);  /* #e5e5e5 */
  border-left: 3px solid var(--brand);  /* #0a0a0a (dark neutral accent stripe) */
  border-radius: 8px;  /* --radius-md */
  font-family: Geist;
  font-size: 12.5px;
  color: var(--neutral-900);
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}

.m-pill-cube {
  color: var(--neutral-500);  /* #737373 (muted cube name) */
}

.m-pill-member {
  font-weight: 500;  /* --fw-medium */
}

.m-pill-id {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 4px;  /* --radius-xs */
  background: var(--neutral-100);
  color: var(--neutral-500);
  font-family: 'Geist Mono', monospace;
  font-size: 10.5px;
}

.m-pill-x {
  width: 18px;
  height: 18px;
  margin-left: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: var(--neutral-500);
  cursor: pointer;
}
.m-pill-x:hover {
  background: var(--neutral-100);
  color: var(--neutral-900);
}
```

**Format:** `cubeName · memberName` (via layout) + monospace path `cube.member` (in `.m-pill-id`) + remove button (`×`).
**Accent stripe:** 3px solid `var(--brand)` on left edge.
**Total height:** 28px. Compact, single-line pill.

---

## Add Pill (`.add-pill`)

```css
.add-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;  /* --radius-md */
  background: transparent;
  color: var(--brand);  /* #0a0a0a */
  border: 1px dashed rgba(240,90,34,0.4);  /* orange-600 @ 40% opacity */
  font-family: Geist;
  font-size: 12.5px;
  font-weight: 500;  /* --fw-medium */
  cursor: pointer;
}
.add-pill:hover {
  background: rgba(240,90,34,0.05);  /* subtle orange tint */
  border-color: var(--brand);
}

.add-pill.danger {
  color: var(--destructive);  /* #dc2626 */
  border-color: rgba(220,38,38,0.35);
}
.add-pill.danger:hover {
  background: var(--red-50);
}

.add-pill.subtle {
  color: var(--neutral-600);
  border-color: var(--neutral-300);
}
.add-pill.subtle:hover {
  background: var(--neutral-50);
  border-color: var(--neutral-400);
  color: var(--neutral-900);
}
```

**Label:** "+ Add" (or "+ Add time" for TIME row).
**Border:** 1px dashed, orange-tinted. **Hover:** soft orange tint.
**Danger variant:** Used for "× Remove all" button (red).

---

## Pre-Aggregation Banner (`.preagg-banner`)

```css
.preagg-banner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(240,90,34,0.06);  /* soft orange tint, ~6% opacity */
  border: 1px solid rgba(240,90,34,0.25);  /* 25% opacity */
  font-family: Geist;
  font-size: 12.5px;
  color: var(--orange-800);  /* #9a3412 (darker orange text) */
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(154,52,18,0.4);  /* muted underline */
}
.preagg-banner:hover {
  background: rgba(240,90,34,0.10);  /* 10% on hover */
}
```

**Position:** Right side of run row (same row as Run button).
**Text:** "Query was not accelerated with pre-aggregation →" (right-pointing arrow).
**Icon:** Small icon on left (Lucide icon, ~14-16px).
**Styling:** Orange chip with underlined text, clickable.

---

## LIVE Badge (`.live-dot`)

```css
.live-dot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  font-weight: 600;  /* --fw-semibold */
  color: #047857;  /* emerald text */
  padding: 2px 7px;
  border-radius: 9999px;  /* full pill */
  background: #d1fae5;  /* emerald-100 soft tint */
  border: 1px solid #a7f3d0;  /* emerald-200 */
}

.live-dot::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #10b981;  /* emerald-600 dot */
  box-shadow: 0 0 0 0 rgba(16,185,129,0.6);
  animation: pulse 1.8s infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.6); }
  50% { box-shadow: 0 0 0 4px rgba(16,185,129,0); }
}
```

**Display:** Inline chip, green with pulsing dot. Used in query card header to indicate live/active state.
**Animation:** Pulse out 1.8s from center dot.

---

## Query Card Container (`.panel`)

```css
.panel {
  background: #fff;
  border: 1px solid var(--neutral-200);
  border-radius: 12px;  /* --radius-2xl */
  box-shadow: var(--shadow-xs);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
```

**Used for:** Query card, Results panel, Chart panel, etc. White background, light border, minimal shadow, flex column layout.

---

## Layout Context (`.v2-body` three-panel grid)

```css
.v2-body {
  display: grid;
  /* grid-template-columns: set inline by JS for dynamic widths */
  gap: 12px;
  padding: 0 12px 12px;
  min-height: 0;
  overflow: hidden;
}
```

**Structure:** Three panels (left: schema sidebar, center: query card + results, right: chart) with 12px gap.

---

## Run Row (Inferred Structure)

**Note:** The standalone HTML does not expose a dedicated `.run-row` or `.run-button` class. The run row structure is inferred from layout context and preagg-banner positioning.

**Expected layout:**
```
┌─────────────────────────────────────────┐
│ [Run Button (orange, primary)]  [Pre-agg banner (orange chip)]  │
└─────────────────────────────────────────┘
```

**Run Button likely uses standard button pattern:**
- `background: var(--primary)` → `#f05a22` (VNGGames orange)
- `color: var(--primary-foreground)` → `#ffffff`
- `border-radius: 8px` (implied from component library)
- `padding: ~10px 16px` (typical CTA button)
- `font-weight: 500` (--fw-medium)
- `font-size: 13px` or `12.5px`
- `:hover` → `background: var(--primary-hover)` → `#f54a00` (darker orange)
- **Label:** "Run query"

**Row styling:**
- `padding: 12px 0` or `12px 16px` (inside the query card)
- `display: flex; gap: 12px; align-items: center;` (button + banner)
- `justify-content: space-between` (button left, banner right)

---

## Query Card Header (Inferred)

**Note:** Specific header class not exposed. Inferred from `.panel` + LIVE badge + collapse pattern.

**Expected structure:**
```
┌──────────────────────────────────────┐
│ Query  [LIVE badge]  [Chevron toggle] │
└──────────────────────────────────────┘
```

**Likely styling:**
- `padding: 16px` or `12px 16px`
- `display: flex; gap: 12px; align-items: center; justify-content: space-between;`
- **Title ("Query"):**
  - `font-family: Geist`
  - `font-size: 14px` or `13px`
  - `font-weight: 600` (--fw-semibold)
  - `color: var(--neutral-900)`
- **LIVE badge:** `.live-dot` (green chip with pulsing dot)
- **Chevron toggle:** Lucide icon, 16-20px, clickable

---

## Filter Row Inline Editor (Inferred)

**Not explicitly visible in CSS.** Expected to be a `.qrow` + `.qrow-content` with inline input or popover.

**Likely pattern:**
- Same row structure as DIMENSIONS, MEASURES, TIME
- `.qrow` with label "FILTERS"
- `.qrow-content` contains:
  - Filter pills (similar to `.m-pill`)
  - "+ Add" button (`.add-pill.subtle`)
  - Inline input field or popover trigger
- **"× Remove all" button** (`.add-pill.danger`) positioned right-aligned below filters (absolute or margin-left: auto)

---

## Remove All Button (`.add-pill.danger`)

```css
.add-pill.danger {
  color: var(--destructive);  /* #dc2626 red */
  border-color: rgba(220,38,38,0.35);
  border: 1px dashed;
}
.add-pill.danger:hover {
  background: var(--red-50);  /* #fef2f2 soft red tint */
}
```

**Label:** "× Remove all"
**Position:** Right-aligned inside filters row or below it.
**Style:** Red, dashed border, transparent bg, danger color text.

---

## Color Mapping Summary

| Element | Color | Hex |
|---------|-------|-----|
| Member pill left stripe | `var(--brand)` | `#0a0a0a` (dark neutral) |
| Add pill border (normal) | `rgba(240,90,34,0.4)` | orange @ 40% |
| Pre-agg banner bg | `rgba(240,90,34,0.06)` | orange @ 6% |
| Pre-agg banner text | `var(--orange-800)` | `#9a3412` |
| LIVE badge bg | `#d1fae5` | emerald-100 |
| LIVE badge text | `#047857` | emerald-700 |
| LIVE badge dot | `#10b981` | emerald-600 |
| Row label text | `var(--neutral-500)` | `#737373` |
| Row border | `var(--neutral-100)` | `#f5f5f5` |
| Pill bg | `#fff` | white |
| Pill border | `var(--neutral-200)` | `#e5e5e5` |

---

## Typography Summary

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Row label | Geist | 10.5px | 600 | `--neutral-500` |
| Pill text | Geist | 12.5px | 400 | `--neutral-900` |
| Pill path (`.m-pill-id`) | Geist Mono | 10.5px | 400 | `--neutral-500` |
| Add button | Geist | 12.5px | 500 | `--brand` |
| LIVE badge | Geist Mono | 10px | 600 | `#047857` |
| Pre-agg banner | Geist | 12.5px | 400 | `--orange-800` |

---

## Spacing Summary

| Element | Space |
|---------|-------|
| Query row padding (vertical) | 10px 0 |
| Query row gap (label ↔ content) | 14px |
| Content flex gap (pills) | 6px |
| Pill internal gap | 6px |
| Add pill padding | 0 10px |
| Pre-agg banner padding | 8px 14px |
| Pre-agg banner gap (icon ↔ text) | 8px |
| LIVE badge padding | 2px 7px |
| Content min-height | 30px |
| Pill height | 28px |

---

## Shadows

- Pills use minimal shadow: `0 1px 2px rgba(0,0,0,0.03)` (almost undetectable)
- Panel uses `var(--shadow-xs)` = `0 1px 2px 0 rgba(0,0,0,0.05)` (subtle drop)

---

## Animations

- **LIVE pulse:** 1.8s infinite, radiates from center green dot
- **Pill/button transitions:** `.12s` ease (implied in hover states)
- **General fade/pop:** `.15s cubic-bezier(.4,0,.2,1)` (library-wide)

---

## Open Questions

1. **Run button styling:** Not explicitly defined in CSS. Assumed to use `--primary` color (`#f05a22`) and standard button patterns, but exact padding/font-size not visible.
2. **Query card header markup:** No specific header class found. Structure inferred from `.panel` + `.live-dot` + collapse pattern.
3. **Run row wrapper:** No dedicated `.run-row` class found. Layout inferred from preagg-banner and button co-location.
4. **Filter inline editor:** Popover/inline input structure not visible in CSS. Likely a radix/headless component or custom React component.
5. **Collapse animation:** No `@keyframes` found for query card collapse. Likely handled by React state (CSS class toggle on `.panel` or child).
6. **Remove all button position:** Expected to be right-aligned via `margin-left: auto` or absolute positioning, but exact layout not visible.

---

## Notes on Extraction Limitations

- **File minification:** JSX/HTML structure is obfuscated; CSS is readable but component wrappers are not explicitly named.
- **Dynamic styling:** Some layout values (e.g., `grid-template-columns` in `.v2-body`) are set inline by JavaScript.
- **Component composition:** Query card likely wraps multiple sub-components (header, run row, rows, filters); the CSS defines individual pieces but not the container hierarchy.

---

**Status:** DONE  
**Summary:** Extracted CSS design tokens, color palette, typography, spacing, shadows, and component styles (.qrow, .m-pill, .add-pill, .preagg-banner, .live-dot, .panel) from v2 standalone HTML. Run button and query header wrappers inferred from context; no breaking discoveries, but exact markup hierarchy requires JSX analysis or Figma source verification.
