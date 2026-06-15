# Design Guidelines

Authoritative reference for typography, color, spacing, and page structure across the cube-playground frontend. All UI surfaces must conform — drift is treated as a bug.

If a rule here conflicts with `src/theme/tokens.css`, the tokens win and this doc must be updated.

## 1. Tokens are the source of truth

All colors, radii, shadows, fonts, and base spacing are declared in `src/theme/tokens.css`. Reference them as CSS variables — never hard-code values when a token exists.

| Surface | Token |
|---|---|
| App background | `var(--bg-app)` |
| Card / panel | `var(--bg-card)` |
| Muted background | `var(--bg-muted)` |
| Card border | `var(--border-card)` |
| Strong border | `var(--border-strong)` |
| Primary text | `var(--text-primary)` |
| Secondary text | `var(--text-secondary)` |
| Muted text | `var(--text-muted)` |
| Brand accent | `var(--brand)` / `var(--brand-hover)` |
| Danger | `var(--danger)` |
| Success | `var(--success)` / `var(--positive)` |
| Warning | `var(--warning)` |

### Semantic soft/ink pairs (for badges, banners, status pills)

Always use the soft+ink pair — they have dark-mode equivalents that raw hex does not.

- `--success-soft` / `--success-ink`
- `--warning-soft` / `--warning-ink`
- `--destructive-soft` / `--destructive-ink`
- `--info-soft` / `--info-ink`
- `--muted-soft` / `--muted-ink`

### Radii

`--radius-xs (4) / --radius-sm (6) / --radius-md (8) / --radius-lg (10) / --radius-xl (12) / --radius-2xl (16) / --radius-full`

### Shadows

`--shadow-xs / --shadow-sm / --shadow-md / --shadow-lg / --shadow-pane`

## 2. Typography

**One font: `var(--font-sans)` (Inter, with system fallbacks).** Apply it on every page wrapper. Do not introduce display fonts, editorial serifs, or bespoke stacks on dashboards, lists, or detail pages.

The `--font-editorial-serif` token exists only for explicitly editorial contexts. Do not pull it into general surfaces.

### Scale (sentence case unless noted)

| Use | Size | Weight | Notes |
|---|---|---|---|
| Page H1 | 20px | 700 | Paired with an icon for top-level pages |
| Section H2 | 18px | 700 | Inside a page |
| Sub-section / card title | 14px | 600 | |
| Body | 13px | 400–500 | |
| Small / meta | 12px | 500 | `var(--text-muted)` for context |
| Eyebrow / kicker | 11px | 600 | `uppercase`, `letterSpacing: '0.06em'`, `var(--text-muted)` |
| KPI numeric | 24px | 700 | `letterSpacing: '-0.015em'`, `fontVariantNumeric: 'tabular-nums'` |

Use `tabular-nums` for any numeric field that the eye needs to scan vertically (KPI tiles, table cells with numbers, deltas).

## 3. Page header pattern

Every top-level page in `src/pages/*` follows this layout. Mirror it; do not invent new shapes.

```tsx
const pageStyle: CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,        // 800 for list pages, 1200–1400 for grids
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

<div style={pageStyle}>
  {/* Optional eyebrow */}
  <div style={eyebrowStyle}>Live operations · {gameId}</div>

  {/* Title row: icon + H1 */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <Activity size={20} style={{ color: 'var(--brand)' }} />
    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
      Daily standup
    </h1>
  </div>

  {/* Lede / subhead — single short sentence, max ~60ch */}
  <p style={{ margin: '4px 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>…</p>
</div>
```

Canonical references: `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/index.tsx`, `src/pages/Liveops/cohort/index.tsx`.

## 4. Spacing scale

Use values from: **4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 48** (px).

Common patterns:
- `padding: '24px 32px'` — page wrapper
- `gap: 10` — title row (icon + heading)
- `marginBottom: 20–24` — between header and content
- `gap: 12` — card row in grids
- `padding: '14px 14px 12px'` — KPI / metric tile
- `padding: '8–10px 14px'` — banner

If you reach for a number outside this list, pause and confirm — almost always there is a closer token.

## 5. Cards, banners, tiles

- Background `var(--bg-card)`
- Border `1px solid var(--border-card)`
- Radius `var(--radius-lg)` (10) or `var(--radius-md)` (8) for tight controls
- Inner padding from the spacing scale above
- Hover lift via `var(--shadow-sm)` — do not change borders on hover

## 6. Buttons

- Primary: `background: var(--brand)`, `color: #fff`, `border: none`, `borderRadius: 6`, `padding: '7px 16px'`, `fontSize: 13`, `fontWeight: 600`.
- Secondary: `background: var(--bg-card)`, `border: 1px solid var(--border-card)`, `color: var(--text-secondary)`, `fontSize: 12`, `padding: '4–6px 10–12px'`.
- Icon-only ghost buttons: transparent background, `color: var(--text-muted)`, no border.

### Header command bar (segment detail pattern)

Secondary page actions (Share / Refresh / Open in Playground) live in one bordered
segmented container — `.commandBar` in `src/pages/Segments/segments.module.css`:
`var(--bg-card)` background, `1px solid var(--border-strong)` border, `var(--radius-md)`,
inner antd buttons stripped (no border/radius, 28px height, `var(--text-secondary)`).
One filled primary button max per header; destructive actions demote to a `⋯` overflow
Dropdown, never adjacent to the primary CTA. All header buttons normalize to 28px.

### KPI tiles

Headline KPI strips use member-360-style tiles (`stats-row.module.css`): auto-fit grid
`minmax(180px, 1fr)` gap 12, each tile `var(--bg-card)` + `var(--border-card)` +
`var(--radius-lg)`, head row = 26px muted icon chip + 11px/600 uppercase label, then a
22px/600 tabular-nums value. Values ≥ 1M compact (`₫10.29B`, `formatCompact` in
`src/pages/Segments/detail/cards/format-value.ts`) with the exact figure in a `title`
tooltip — never render full billions inline.

### Chart card headers + datetime axes

Chart cards (`card-shell.tsx`) render: 24px muted icon chip + 13px/600 title + a
mono pill unit chip (`users` / `VND` / `%`, `resolve-card-unit.ts`) shown only when it
adds info beyond the title. No subtitle lines. Chart x-axis datetimes go through
`src/utils/format-chart-datetime-label.ts` ("Apr 7", hour grain "Apr 7 14:00", year on
year boundaries; tooltips "Apr 7, 2026") — never render raw ISO timestamps on an axis.

## 6b. Left nav bar (shell sidebar)

The shell is a **warm "L" frame with an inset white content panel** (edge-to-edge —
no outer gutter). The sidebar (`src/shell/sidebar/`) and the topbar share one warm
color (`T.sidebar` `#f9f6f2`) and connect **seamlessly with no divider** — together
they form a continuous warm L down the left and across the top. The main content
`<main>` and the chat panel are **inset white cards** (`T.surface`) with a rounded
top-left corner (`borderTopLeftRadius: 12`) and a hairline top + left border
(`T.n200`); they sit flush to the viewport right/bottom. `ShellLayout` uses
`padding: 0` / `gap: 0`. Topbar is `background: T.sidebar` with **no** bottom border.
Do not reintroduce the floating-card frame, and do not put a divider between sidebar
and topbar.

- **Seam = invisible at rest:** the `SidebarEdgeToggle` element is transparent at
  rest (so sidebar + topbar read as one warm surface); a faint line (`T.n200`) and
  the collapse circle appear only on hover.
- **Collapse toggle:** on hover the seam tints and
  a 36px circle appears straddling the seam, **tracking the cursor's Y** and sliding
  with it. Icon = `ChevronLeft` (expanded) / `ChevronRight` (collapsed). Clicking
  anywhere along the seam toggles. Do not revert this to a fixed centered button.
- **Section header = two hit targets:** the icon+label **navigates**; a separate
  arrow button **toggles** the child list (rotates `-90°`→`0°`). The row shares one
  hover bg; the arrow darkens on direct hover. Never merge these back into one
  navigate-and-toggle row.
- **Child rows:** text color brightens on hover (muted → foreground); **no** hover
  background.

## 7. Dark mode

Dark mode is real — every soft/ink + raw color token has a dark-mode equivalent in `:root[data-theme="dark"]`. If a surface relies on raw hex it will break in dark mode. Use semantic tokens.

## 8. When extending

1. Read `src/theme/tokens.css` end-to-end before adding new visual primitives.
2. Cross-check with the nearest well-formed page (Dashboards, Cohort, Segments).
3. Only introduce a new token (in `tokens.css`) when no existing token fits — and when you do, add light + dark values together.
4. Components in `src/components/`, `src/pages/Segments/visuals/`, and `src/pages/Liveops/_ui/` are reusable — prefer extending them over forking.

## 9. Anti-patterns

- Bespoke hex codes inline (`#fee2e2`, `#dc2626`) instead of `--destructive-soft` / `--destructive-ink`.
- Serif or display fonts on dashboards or data pages.
- New page-header shapes that don't match the icon+20/700 title.
- Hand-rolled shadows or border-radius values.
- Mixing `var(--font-sans)` and `var(--font-editorial-serif)` on the same surface.
- Inlining `box-shadow`, `borderRadius`, and `padding` with raw numbers when tokens exist.

Drift from this doc is a bug; fix at the surface that drifted, then ensure tokens are sufficient.

## 10. Theme visual-regression gate

A Playwright gate pins the UI pixel-intact in **both light and dark** while the theme is centralized onto semantic tokens. It captures the major routes (`tests/visual/routes.manifest.ts`) in each theme and diffs against committed baselines under `tests/visual/theme-routes.spec.ts-snapshots/`.

**Run the gate** (requires the local dev stack up — vite `:3000` → fastify `:3004` → cube `:4000`, auth bypassed as bootstrap admin):

```bash
npm run test:visual:theme          # diff current UI against committed baselines
npm run test:visual:theme:update   # re-capture baselines (intentional change only)
```

How it stays deterministic:

- Theme is seeded pre-boot (localStorage mirror `gds-cube:theme`) and re-asserted on `documentElement[data-theme]` after hydration — the CSS keys off that attribute.
- Transitions/animations/caret are frozen via an injected stylesheet.
- Live-data regions are masked so data churn never fails the **color** gate: `GLOBAL_MASK` (charts/canvas) plus any element marked `data-visual-volatile` (e.g. the cohort retention grid, whose cell colors are a value-driven heatmap, not theme tokens).

**Updating baselines is a deliberate act.** Only run `:update` when a visual change is intended; review the regenerated PNGs before committing, and note the rationale (e.g. "dark-mode surface now correctly adapts after migrating off a literal hex"). A green gate after a refactor step is the proof that step kept the UI intact.

## 11. Token architecture — the three-tier model

The theme is being centralized onto one canonical layer in `src/theme/tokens.css`. The target model:

1. **Primitives (private):** single-meaning raw values — the `--neutral-*` / `--orange-*` scales and bespoke status/cluster hues. A primitive never changes role between light and dark.
2. **Semantic tokens (the contract components read):** `--bg-app/card/muted`, `--surface-{shell,sidebar,topbar,panel,raised,muted,subtle}`, `--border-card/strong`, `--text-primary/secondary/muted`, status `--*-soft/--*-ink`, `--radius-*`, `--shadow-*`, `--font-*`, `--chart-*` / `--chart-series-*`. Re-pointed per theme in the `:root` / `[data-theme="dark"]` blocks.
3. ~~**Compat aliases:** `--hermes-*`~~ — **removed.** The `--hermes-*` scale and the `T.*` color proxy are deleted; `T` exposes fonts only. Components read tier-2 semantic tokens directly.

The migration is complete: zero `T.<color>` references, zero raw `var(--neutral-*)` / `var(--hermes-*)` outside `src/theme/`. The `--neutral-*` scale survives **only as a private primitive** feeding the tier-2 tokens inside `tokens.css`.

### Surface tiers (new)

`--surface-shell / -sidebar / -topbar / -panel / -raised / -muted / -subtle` express the **app-frame** surfaces, intentionally distinct from the content `--bg-*` canvas (the warm two-tone "Actioneer" frame in light; a cooler near-black frame in dark).

### Component primitives (migrated off the raw `--neutral-*` scale)

The dual-meaning `--neutral-50..300` (warm cream in light, redefined near-white in dark) was a footgun when read directly by components. These single-meaning tokens replace those uses:

| Token | Role | Light → Dark |
| --- | --- | --- |
| `--surface-inset` / `--surface-inset-strong` | inset/selected-row + deeper track/hover/shimmer surfaces | warm cream → proper dark surface (fixes the former near-white-in-dark bug) |
| `--surface-inverse` | always-dark surface (tooltips, code blocks) | `#171717` (invariant) |
| `--text-inverse` / `--text-inverse-dim` | text on `--surface-inverse` | invariant |
| `--fill-muted` / `--fill-faint` | muted/faint **decorative** fills (bars, dots, empty stars, handles) | invariant grey (same both modes by design) |

### Chart palette

`--chart-1..5` are individual **accent** colors (sparklines, member pills, compare panes). `--chart-series-1..8` are the ordered **categorical series** palette — the source of truth for the `CHART` array in `src/shell/theme.tsx`. `CHART` stays literal hex (mirroring `--chart-series-*`) because its values feed recharts `fill`/`stroke` SVG presentation attributes, where CSS `var()` does not resolve; it is the one allowlisted inline-hex array. (`--chart-series-3` is a distinct green from the teal `--chart-3` accent — both intentional.)

### Shell `T.*` → semantic migration key

| `T.*` member | Value intent | Semantic target |
| --- | --- | --- |
| `surface`, `surfaceMuted`, `surfaceSubtle` | raised / muted / subtle frame surface | `--surface-raised` / `--surface-muted` / `--surface-subtle` |
| `shell`, `sidebar`, `topbar`, `panel` | frame tiers | `--surface-shell` / `-sidebar` / `-topbar` / `-panel` |
| `brand`, `brandHover`, `brandSoft`, `brandBorder` | brand accent | `--brand` / `--brand-hover` / `--brand-soft` / (brand border) |
| `n900`, `n950` | strong / max-contrast text | `--text-primary` |
| `n600`, `n700`, `n800` | secondary text / dividers | `--text-secondary` / borders |
| `n400`, `n500` | muted text / icons | `--text-muted` |
| `n200`, `n300` | hairline / strong border | `--border-card` / `--border-strong` |
| `fSans`, `fMono` | fonts (kept on `T`) | `--font-sans` / `--font-mono` |

**⚠ Divergence note (historical).** The retired `--hermes-*` scale was NOT byte-identical to the content semantic tokens: in light it was cool-grey Tailwind neutral while `--border-card`/muted surfaces were *warmed*; in dark the frame was blue-toned vs the grey content scale. So the shell migration preserved each value via a surface/shell-scoped token rather than snapping to a near-but-unequal content token, gate-verified per batch.

## 12. Enforcement — keep the contract from drifting

The single-token contract is guarded by a linter + pre-push gate (there is no in-repo CI; deploy is a push to the `second` remote).

- **`npm run lint`** → `scripts/lint-theme-tokens.mjs`. Fails on: (1) inline hex in `src/**/*.{ts,tsx}`, (2) raw `var(--neutral-*)` / `var(--hermes-*)` anywhere outside `src/theme/`, (3) the retired `T.<color>` proxy. The theme layer (`src/theme/`) and test files are exempt.
- **Pre-push hook** → `scripts/git-hooks/pre-push` runs `npm run lint` and blocks the push on violations (activated by the `prepare` script: `core.hooksPath=scripts/git-hooks`). Emergency bypass: `git push --no-verify`.
- **Inline-hex allowlist** (in the linter's `HEX_ALLOWLIST`): chart-series / data-viz palettes and recharts SVG `fill`/`stroke` (CSS `var()` does not resolve in SVG attrs), categorical type/syntax-tone palettes, and 3rd-party brand marks. One tracked exception: `metric-list-row.tsx` trust hues (deferred — converging needs a light re-baseline).

### How to add a color

1. **Need a new color?** Define it in `src/theme/tokens.css` for **both** themes (a semantic token if it has meaning; a component primitive like `--fill-*` / `--surface-inset` if it's a single-meaning decorative/surface value). Never inline a hex in a component.
2. **Reference it** from the component as `var(--your-token)`.
3. **Genuinely literal hex** (a new chart palette / SVG attr / brand mark)? Add the file path to `HEX_ALLOWLIST` in `scripts/lint-theme-tokens.mjs` with a one-line reason.
4. Run the §10 visual gate (light + dark). New dark surfaces that fix a prior bug → re-baseline dark with rationale; light must stay pixel-intact.
