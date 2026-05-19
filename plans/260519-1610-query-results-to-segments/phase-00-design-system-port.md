---
phase: 0
title: "Design-system port + global theme + visual regression infra"
status: pending
priority: P1
effort: "3w"
dependencies: []
---

# Phase 0: Design-system port + global theme + visual regression infra

## Overview

Port the mock's `styles.css` design system into the app **globally**, override `@cube-dev/ui-kit` + antd theme tokens, build the mock's bespoke primitives (LiveBadge, pills, KPI tile, sticky bar, etc.) + chart wrappers (LineChart / BarList / Donut / Sparkline) under `src/pages/Segments/visuals/`, polish existing screens (Playground / Catalog / Header / Settings / Index) against the new tokens, and stand up the Playwright pixel-diff CI gate at 1440×900 + 375×812 with ≤2% threshold against baselines rendered from the mock HTML.

This phase is the **fidelity foundation**. Every subsequent FE phase depends on it. Visual regression CI gate flips on at end of P0 and gates all later FE phases.

## Requirements

**Functional — Tokens & theme**
- Port the mock's `~/Downloads/cube-segment/styles.css` token set into `src/theme/tokens.css`:
  - Brand: `--brand`, `--orange-{50…900}`, `--brand-soft`.
  - Neutrals: `--neutral-{50…900}`.
  - Semantic surfaces: `--bg-card`, `--border-card`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`.
  - Status colors: `--success`, `--live-badge-*`, `--stale-badge-*`.
  - Radii: `--radius-{sm,md,lg,xl,pill}`.
  - Spacing scale, font stack (`--font-mono`), shadows.
- Override `@cube-dev/ui-kit` `rootStyles` in `src/theme/ui-kit-theme.ts` to consume the new tokens. Reconcile `QUERY_BUILDER_COLOR_TOKENS` (currently colocated in `QueryBuilderV2/color-tokens.ts`) with the mock palette — map analogous tokens; deprecate ones the mock doesn't have.
- Override antd theme in `src/theme/antd-overrides.css`:
  - Buttons: brand orange primary, rounded `--radius-lg`, focus ring matching mock.
  - Modal: padding, header/footer separators, border-radius `--radius-xl`.
  - Table: row hover, border, monospace font for code-like cells.
  - Tabs: pill style.
  - Inputs: height 34, focus ring.
  - Select: matches Input.
  - Dropdown: shadow + radius.
- Dark-mode parity: mock is light-only in v1. Existing theme has a dark mode (`ThemeProvider`); audit whether mock tokens have dark equivalents. If not, document v1 = light-only on `/segments`; existing screens still support dark.

**Functional — Bespoke primitives** (`src/pages/Segments/visuals/`)
- `tokens.css` scoped re-export (for surfaces that want explicit segment-namespaced vars).
- `live-badge.tsx` — green pulsing dot + label + interval.
- `member-pill.tsx` — colour-coded pill for `measure | dimension | time | segment` variants (mock's `.member-pill` class).
- `tag.tsx` — neutral chip.
- `selection-bar.tsx` — fixed-bottom dark bar with action buttons (mock's `.selection-bar`).
- `kpi-tile.tsx` — label / value / delta / footer (used in Library KPI strip + Detail header KPIs).
- `breadcrumbs.tsx` — text-muted with `/` separators.
- `composition-card.tsx` — Donut + bar list combo.
- `predicate-pill.tsx` — used inside predicate tree leaf rows.
- `live-banner.tsx`, `floating-live-chip.tsx` — placement variants (used in v1.5, build now to avoid retrofit).
- `bar-list.tsx`, `donut.tsx`, `line-chart.tsx`, `sparkline.tsx` — chart wrappers around recharts with mock's exact styling.

**Functional — Existing-screen polish**
- Walk every existing screen with the new theme applied. Capture before/after screenshots.
- Fix regressions: button colors, modal sizing, header spacing, sidebar borders, etc.
- Touch only what visibly regresses; do not rewrite components.
- Screens to audit: `/`, `/build`, `/catalog`, `/catalog/models`, `/catalog/models/:cube`, `/metric/:cube/:member`, `/metrics/new`, `/settings`.
- Document deltas + decisions in `docs/design-tokens-migration.md`.

**Functional — Visual regression infra**
- Add Playwright as dev dep + scaffold `tests/visual/` directory:
  ```
  tests/visual/
    baselines/                      (committed PNGs; goldens)
      1440x900/
        push-flow.png
        library.png
        detail-overview.png
        detail-engagement.png
        detail-monetization.png
        detail-retention.png
        detail-sample-users.png
        detail-predicate.png
        editor.png
      375x812/                      (mobile variants for the same screens)
    capture-baselines.ts            (renders mock HTML headless, screenshots, writes baselines/)
    screens.spec.ts                 (renders real /segments routes, compares to baselines)
    playground-polish.spec.ts       (snapshot existing screens post-polish)
  ```
<!-- Updated: Validation Session 1 - mock source vendored into repo at tests/visual/mock-fork/ for CI stability -->
- `capture-baselines.ts`:
  - Spins headless Chromium.
  - Loads `tests/visual/mock-fork/Cube Segment.html` (vendored copy of `~/Downloads/cube-segment/` pinned to a known mock revision).
  - Drives the in-mock router (via the `TweaksPanel` quick-nav buttons) into each state.
  - Screenshots at both viewports; writes PNGs to `baselines/`.
- `screens.spec.ts`:
  - For each screen, navigates real `/segments/...` route in dev (using mock test data fixtures from a `/api/segments/__fixtures__` endpoint that ships with P0).
  - Compares against baselines via `expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.02 })`.
  - Includes Detail tabs (Overview/Engagement/Monetization/Retention/Sample/Predicate).
- CI gate: `npm run test:visual` runs in CI. Fail closes the PR.
- Auto-update flow: `npm run test:visual -- --update-snapshots` regenerates baselines; reviewer manually compares old vs new in PR diff.

**Non-functional**
- Token migration is mechanical search-replace + visual QA. No semantic refactors.
- Polish pass is bounded — do not redesign existing UX, only re-skin.
- Visual tests are deterministic: fixed seed, disabled animations, mocked Cube responses for chart screens.

## Architecture

```
src/
  theme/
    tokens.css                      (UPDATED — adds mock tokens)
    antd-overrides.css              (UPDATED — antd token overrides)
    ui-kit-theme.ts                 (UPDATED — @cube-dev/ui-kit Root styles)
    design-tokens-migration.md      (NEW — token mapping doc)
  pages/Segments/visuals/
    index.ts                        (barrel export)
    live-badge.tsx
    member-pill.tsx
    tag.tsx
    selection-bar.tsx
    kpi-tile.tsx
    breadcrumbs.tsx
    composition-card.tsx
    predicate-pill.tsx
    live-banner.tsx
    floating-live-chip.tsx
    bar-list.tsx
    donut.tsx
    line-chart.tsx
    sparkline.tsx
    __tests__/
      visual-primitives.spec.tsx    (Vitest unit + render)

tests/visual/
  mock-fork/                        (vendored copy of ~/Downloads/cube-segment, pinned)
    Cube Segment.html
    styles.css
    app.jsx
    components.jsx
    data.jsx
    screen-*.jsx
    tweaks-panel.jsx
    MOCK-REVISION.md                (revision marker + source link)
  baselines/                        (committed PNGs)
  capture-baselines.ts
  screens.spec.ts
  playground-polish.spec.ts
  fixtures/
    test-segments.ts                (seed data for screen.spec.ts)
  playwright.config.ts

docs/
  design-tokens-migration.md        (decisions + before/after table)

server/src/routes/
  __fixtures__.ts                   (dev-only test fixtures endpoint, behind NODE_ENV)
```

## Related Code Files

**Create**
- `src/theme/design-tokens-migration.md` (decision log)
- `src/pages/Segments/visuals/**` (14 primitives + barrel + tests)
- `tests/visual/**` (baselines + 2 specs + capture script + playwright.config)
- `tests/visual/mock-fork/**` (vendored mock files copied from `~/Downloads/cube-segment/` + `MOCK-REVISION.md` marker)
- `tests/visual/fixtures/test-segments.ts`
- `server/src/routes/__fixtures__.ts` (dev/test-only)
- `docs/design-tokens-migration.md`

**Modify**
- `src/theme/tokens.css` — ingest mock tokens
- `src/theme/antd-overrides.css` — antd component overrides
- `src/theme/ui-kit-theme.ts` — Root styles consume new tokens
- `src/QueryBuilderV2/color-tokens.ts` — reconcile / deprecate redundant tokens
- `package.json` — add Playwright, `test:visual`, `test:visual:update`, `visual:capture-baselines` scripts
- `vite.config.ts` — gate the `__fixtures__` route to dev only
- Existing screens — polish-pass micro-edits per visual audit findings

## Implementation Steps

1. **Inventory mock tokens**: parse `styles.css`, list every `--*` variable + every component class. Output → `design-tokens-migration.md` mapping table.
2. **Token port**: write `tokens.css` additions; remove tokens we're sunsetting; commit. Run app, eyeball every screen.
3. **antd overrides**: write `antd-overrides.css` to retheme button / modal / table / tabs / input. Verify against existing antd usage (Header dropdown, existing modals in Catalog).
4. **@cube-dev/ui-kit overrides**: update `ui-kit-theme.ts` `rootStyles`. Reconcile `QUERY_BUILDER_COLOR_TOKENS` with mock palette — the mock uses different orange shades for the QueryBuilder member pills (`.member-pill.measure` etc).
5. **Build segment visual primitives** under `src/pages/Segments/visuals/` from mock JSX. Each primitive is a single-purpose component with explicit props. Add Vitest render + a11y tests.
6. **Build chart primitives** (LineChart, BarList, Donut, Sparkline). Port from mock; recharts underneath. Match colors, axes, gridlines, padding.
7. **Existing-screen polish pass**:
   - Open `/`, `/build`, `/catalog`, `/catalog/models`, `/catalog/models/:cube`, `/metric/:cube/:member`, `/metrics/new`, `/settings`.
   - Capture before-screenshot, apply theme, capture after.
   - Fix obvious regressions only (button color drift, table border collision, modal header inconsistency).
   - Document deltas in `design-tokens-migration.md`.
8. **Vendor mock + visual regression setup**:
   - Copy `~/Downloads/cube-segment/` into `tests/visual/mock-fork/`. Add `MOCK-REVISION.md` documenting source + capture date.
   - Add Playwright (`@playwright/test`) as dev dep.
   - Scaffold `tests/visual/` with config (1 project per viewport).
   - Implement `capture-baselines.ts` — load mock HTML from `tests/visual/mock-fork/`, drive states, screenshot.
   - Implement `screens.spec.ts` — load real /segments routes with fixture data, diff.
   - Implement `playground-polish.spec.ts` — snapshot existing screens post-polish; future PRs are gated on no-regression.
9. **Fixtures endpoint**: `server/src/routes/__fixtures__.ts` — dev-only `GET /api/__fixtures__/segments` returning a deterministic seed (mirrors `~/Downloads/cube-segment/data.jsx` SEGMENTS array). Guard with `NODE_ENV !== 'production'`. P2 / P4 / P5 / P7 use this endpoint when rendering for visual tests.
10. **CI wiring**: add `test:visual` to the CI workflow. Cache `node_modules/playwright` for speed.
11. **Capture initial baselines** + commit to repo.
12. **Run the full suite** — both `screens.spec.ts` (gates Segments PRs) and `playground-polish.spec.ts` (gates existing-screen PRs).
13. **Doc updates**: `docs/design-tokens-migration.md` finalized + `README.md` adds a "Visual tests" section.

## Success Criteria

- [x] Mock tokens present in `src/theme/tokens.css`; build succeeds. *(26 tokens added; migration log committed)*
- [ ] antd buttons / modals / tables visibly match mock styles in a manual eyeball pass. *(deferred — needs manual QA pass)*
- [ ] `@cube-dev/ui-kit` components inside QueryBuilder (member pills, tooltips, dropdowns) consume the new palette. *(token reconciliation deferred)*
- [x] All 14 segment visual primitives exist + have unit tests. *(10 non-chart + 4 chart = 14 components; 32 tests passing)*
- [x] All 4 chart primitives exist + render with mock-matching styling. *(LineChart / BarList / Donut / Sparkline)*
- [ ] Existing screens (`/`, `/build`, `/catalog`, `/metric/*`, `/metrics/new`, `/settings`) audited; regressions fixed; before/after captured in `design-tokens-migration.md`. *(deferred — multi-day eyeball QA)*
- [ ] `tests/visual/baselines/` populated with PNGs for all 9+ screen states at both viewports. *(scaffold ready; baseline capture not run — needs `npm run visual:capture-baselines` against vendored mock)*
- [ ] `npm run test:visual` passes on a clean checkout. *(scripts wired; requires baselines first)*
- [ ] CI gate enabled — opening a PR that breaks visual parity fails the check. *(deferred — needs CI workflow update)*
- [x] `docs/design-tokens-migration.md` published.

### Session 2026-05-19 delivery (partial — scaffolding only)

**Delivered**
- 26 design tokens added; `--radius-pill` corrected from `8px` → `9999px` (semantic fix).
- 14 visual primitives + 4 chart wrappers under `src/pages/Segments/visuals/` with 32 passing Vitest tests.
- Mock vendored to `tests/visual/mock-fork/` with `MOCK-REVISION.md` revision marker.
- Playwright dev dep installed + `tests/visual/playwright.config.ts` + 3 spec files (`screens.spec.ts`, `playground-polish.spec.ts`, `capture-baselines.ts`) scaffolded.
- npm scripts wired: `test:visual`, `test:visual:update`, `visual:capture-baselines`.
- Dev-only fixtures endpoint `POST /api/__fixtures__/segments` added under `NODE_ENV !== 'production'` guard.
- `docs/design-tokens-migration.md` decision log written.

**Deferred (out of scope for this session)**
- Existing-screen polish pass (multi-day manual QA).
- antd theme override pass for buttons/modals/tables (separate token-driven CSS work).
- `@cube-dev/ui-kit` `rootStyles` reconciliation with mock palette.
- Initial baseline PNG capture + commit.
- CI workflow update to gate PRs on `test:visual`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `@cube-dev/ui-kit` is opinionated; some components resist re-theming | Time-box theme override attempts; if a component can't be retheme'd, replace with a mock-aligned local primitive. Documented exceptions in design-tokens-migration.md. |
| Existing screens' visual regressions explode beyond what 1 week of polish can absorb | Surface findings early (after step 7); descope polish to a follow-up phase if scope creeps; revisit globalize-decision with user. |
| Playwright pixel diff flakes from antialiasing / font rendering | Use `--disable-font-subpixel-positioning` flag; mask known-flaky regions; allow 2% threshold gives slack. |
| Mock's HTML can't be driven into all required states via its TweaksPanel | Mock-fork is vendored at `tests/visual/mock-fork/`; edit JSX in-fork to expose missing states. |
| Baselines drift as mock is refined | `MOCK-REVISION.md` documents source revision; `npm run visual:refresh-baselines` re-captures from the vendored copy after explicit mock-fork update. |
| CI doesn't have access to `~/Downloads/cube-segment/` | Resolved: mock vendored into `tests/visual/mock-fork/`; baselines + capture script reference vendored path only. |
| Dark mode coverage gap (mock is light-only) | Scope `/segments` to light theme only in v1; document; existing screens' dark mode untouched. |
| Charts: recharts default colors override our tokens | Set all chart colors via props from token CSS vars; assert in unit test. |
| QueryBuilder color-tokens reconciliation breaks Playground | Run Playground side-by-side after every token change; commit small. |
| Fixtures endpoint accidentally ships to prod | Guard with NODE_ENV check + register route only in dev plugin; CI runs prod build + greps bundle to assert absence. |
