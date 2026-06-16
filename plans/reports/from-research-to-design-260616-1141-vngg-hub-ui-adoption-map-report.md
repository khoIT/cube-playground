# VNGG Hub UI → cube-playground adoption map

Research of VNGG Hub UI design system (https://hub-ui.hostapp.vnggames.net) vs cube-playground's just-centralized token layer. Source = real `@vnggh/vnggh-cli@0.10.2` registry (read from private npm registry), not scraped docs.

## What VNGG Hub UI actually is

- **Stack:** React ≥18 + **Tailwind CSS v4 ONLY** (CLI refuses v3/non-Tailwind) + TS ≥5. Runtime deps: `clsx`, `tailwind-merge`, `tailwind-variants` (tv), `@floating-ui/react`, `dayjs`.
- **Delivery = shadcn-style copy-in.** `npx vngghui add button table` copies component **source into your repo** (`@/components/ui/...`), resolves transitive deps + inline icons. Not a runtime component import. Private registry `@vnggh` on `registry-aawp.vnggames.net`.
- **Scale:** `vngg-base` (tokens/utils) + **55 UI components** + 1700+ icons (line/solid sets) + an MCP server & `vnggh-ui` agent skill for AI scaffolding.
- **Tokens (`vngg-base/styles.css`, 5966 lines):** Radix-Colors-style **12-step scales** (`--color-brand-1..12`, `--color-neutral-1..12`) + alpha variants (`--color-brand-alpha-3`), feeding a **state-aware semantic fill taxonomy**: `--color-bg-fill-{intent}-{variant}-{state}` where intent = accent/neutral/positive/negative/warning/info, variant = solid/ghost/subtle/flat, state = default/hover/pressed. Plus `--color-content-*`, `--color-border-*`, `--color-comp-{button,badge,avatar}-*` component tokens.
- **Multi-axis theming via data-attrs on `<html>`:** `data-theme` (light/dark) × `data-radius` (rounded/smooth/standard/luxury) × `data-emphasis` (medium/strong) × `data-component-theme` (brand/neutral) × `data-brand-bright`. Components read tokens; switching an attr restyles globally (Tailwind v4 `@custom-variant`).
- **Components consume tokens via Tailwind utilities** (`bg-comp-button-primary-default text-comp-button-primary-content hover:not-disabled:bg-comp-button-primary-hover`), composed with `tv()`.

## The two systems already converge on the foundation

| Axis | VNGG Hub UI | cube-playground | Verdict |
|------|-------------|-----------------|---------|
| Brand primary | `--color-brand-9 = #f05a22` | `--brand` / shadow `rgba(240,90,34)` = **#f05a22** | **IDENTICAL** |
| Body font | Inter (+ Vietnamese subset) | Inter (`--font-sans`) | **IDENTICAL** |
| Mono/code | JetBrains Mono | `--bg-code` only | partial |
| Theming model | `data-theme` attr + CSS vars | `data-theme` attr + CSS vars | **SAME MODEL** |
| Token layer | semantic, layered, single contract | semantic, single contract (just centralized) | **SAME SHAPE** |
| Delivery | Tailwind v4 + tv() + copy-in | Ant Design + cube ui-kit `tasty` + inline `style={{var()}}`, **no Tailwind** | **OPPOSITE** |
| Charts | own bar/line/pie/funnel/gauge/heatmap/radar | recharts | different |

## Core tension

Wholesale adoption is a **stack migration**: the `vngghui` CLI hard-requires Tailwind v4, and cube-playground has no Tailwind (it's Ant + tasty + inline-var styles). Importing components also means replacing Ant Design. That fights the token-centralization just shipped and is high-risk. So adoption must be **layered, not lift-and-shift**.

## Recommendation tiers (leverage ÷ effort)

1. **Token-taxonomy convergence (DO — pure CSS, no stack change).** Re-express cube-playground's semantic tokens in VNGG's naming/structure (`--color-content-*`, `--color-bg-fill-{intent}-{variant}-{state}`, `--color-border-*`, 12-step `--color-{brand,neutral}-N`). Brand + font already match, so this is mostly aliasing + filling the state-aware fill matrix. Outcome: cube-playground reads visually identical to other VNGG apps and becomes *ready* to drop in vngg components later. The recent single-token-layer refactor makes this a contained remap.
2. **Adopt the extra theming axes (cheap win).** Add `data-radius` / `data-emphasis` knobs (already have `data-theme`) for product-wide restyle without touching components.
3. **Mirror component anatomy (don't import).** Replicate VNGG's spec for the ~18 overlapping components in cube-playground's existing inline-style components — same variants/states/sizing/tokens, no Tailwind. This is the component-by-component huashu illustration.
4. **Greenfield rule.** Any NEW standalone app/micro-frontend → start on VNGG Hub UI directly (org standard), not the bespoke stack.
5. **Don't swap now:** recharts (fine), Ant Design wholesale (too costly), the CLI/Tailwind requirement (blocker for in-place).

## Component overlap (55 → cube-playground surfaces)

**Direct overlap (illustrate):** button, badge, chip, tag, input-field, select-field, checkbox, radio, toggle, segmented, tab, table, metric-card, list-item, sidebar, side-panel, dialog/modal, tooltip, popover, toast, inline-message/alert-banner, progress, breadcrumb, pagination, search, stepper.
**Charts (skip — recharts):** bar/line/pie/funnel/gauge/heatmap/radar/chart.
**Lower priority / mobile:** bottom-navigation, bottom-sheet, top-navigation-mobile, calendar, event-calendar, date-picker, time-picker, rich-text-editor, file-uploader, rating, avatar, code, divider, number-field, slider, accordion, field-shell, input-heading.

## Unresolved questions

1. Is org mandate to standardize on Hub UI, or is convergence opt-in? (Changes whether Tier 1 is "nice" or "required".)
2. Appetite for introducing Tailwind v4 alongside Ant (enables real component adoption) vs staying inline-var + mirroring (Tier 3)?
3. Vietnamese font subset needed in cube-playground (VNGG ships it)?
