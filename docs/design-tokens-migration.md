# Design Tokens Migration

Decision log for the token delta between the mock design system and the existing `src/theme/tokens.css`.

## Token Delta — Added from Mock

These tokens existed in the mock's `styles.css` but were absent from `tokens.css` and have been added.

| Token | Value | Reason Added |
|---|---|---|
| `--orange-300` | `#fdba74` | Mock uses it for avatar gradients and badge backgrounds |
| `--orange-800` | `#9a3412` | Complementing the orange scale for text-on-light use |
| `--orange-900` | `#7c2d12` | Mock uses it for deep brand text / preagg banner |
| `--neutral-150` | `#ededed` | Mock mid-step between 100 and 200; used in table dividers |
| `--radius-xs` | `4px` | Mock uses for inner UI (checkbox, code chips) |
| `--radius-sm` | `6px` | Mock's default small radius (badge, group-conj) |
| `--radius-md` | `8px` | Mock's input/button radius |
| `--radius-lg` | `10px` | Mock's kpi tile, predicate block |
| `--radius-xl` | `12px` | Mock's card and modal radius |
| `--radius-2xl` | `16px` | Mock's selection bar |
| `--radius-full` | `9999px` | True pill; mock's `.tag`, `.hbar`, `.avatar` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.08)…` | Mid-level elevation; mock modals/sheets |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.12)…` | Selection bar shadow |
| `--static-badge-bg` | `#f5f5f5` | Non-live segment badge background |
| `--static-badge-border` | `#e5e5e5` | Non-live segment badge border |
| `--static-badge-text` | `#525252` | Non-live segment badge text |
| `--member-pill-measure-bg` | `rgba(225,210,183,0.55)` | Segment member pill — measure variant |
| `--member-pill-measure-text` | `var(--qb-measure-text)` | Derived from QB palette |
| `--member-pill-dimension-bg` | `rgba(200,212,239,0.45)` | Segment member pill — dimension variant |
| `--member-pill-dimension-text` | `var(--qb-dimension-text)` | Derived from QB palette |
| `--member-pill-segment-bg` | `rgba(219,206,233,0.55)` | Segment member pill — segment variant |
| `--member-pill-segment-text` | `var(--qb-segment-text)` | Derived from QB palette |
| `--member-pill-time-bg` | `rgba(199,219,195,0.55)` | Segment member pill — time variant |
| `--member-pill-time-text` | `var(--qb-time-text)` | Derived from QB palette |
| `--header-h` | `44px` | App shell header height constant |
| `--font-ui` | `'Inter', …` | Mock secondary UI font (nav, labels) |

## Token Delta — Kept / Already Present

These tokens exist identically in both the mock and `tokens.css`. No change needed.

| Token | Value | Notes |
|---|---|---|
| `--neutral-{50…950}` | Same palette | Tailwind v4 neutrals — exact match |
| `--orange-{50,100,200,400,500,600,700}` | Same values | Already present; only 300/800/900 were missing |
| `--brand`, `--brand-hover`, `--brand-soft` | `var(--orange-{600,700,50})` | Identical semantic alias |
| `--bg-app`, `--bg-card`, `--bg-muted` | Same | Surface tokens match |
| `--border-card`, `--border-strong` | Same | Border tokens match |
| `--text-primary`, `--text-secondary`, `--text-muted`, `--text-on-brand` | Same | Text tokens match |
| `--warning`, `--info` | Same | Status colors match |
| `--shadow-xs`, `--shadow-sm` | Same | Low-elevation shadows match |
| `--font-sans`, `--font-mono` | Same | Typography stack matches |
| `--qb-{measure,dimension,segment,time}-{strong,text,active}` | Same | QB palette identical |
| `--live-badge-{bg,border,text,dot}` | Same | Live badge tokens match |
| `--stale-badge-{bg,border,text,dot}` | Same | Stale badge tokens match |

## Token Delta — Divergence / Override Decisions

| Token | Existing Value | Mock Value | Decision |
|---|---|---|---|
| `--success` | `#009688` (teal) | `#16a34a` (green) | **Keep existing** — teal is already used in chart palette and dark-mode QB tokens; changing would break existing screens. Mock's green is only used for live-badge which already has `--live-badge-dot: #10b981`. |
| `--danger` | `#ef4444` | `#dc2626` | **Keep existing** — both are red; existing value used by QB filter tokens and add-pill danger rules. |
| `--radius-pill` | `8px` (old alias) | `9999px` | **Updated to `9999px`** to match mock. Old value was incorrectly named; `--radius-full` is the canonical pill token going forward. Legacy alias preserved but now equals `9999px`. |
| `--radius-card` | `12px` | n/a (mock uses `--radius-xl`) | **Kept** as alias; `--radius-xl: 12px` is the canonical name. |
| `--radius-input` | `8px` | n/a (mock uses `--radius-md`) | **Kept** as alias; `--radius-md: 8px` is the canonical name. |

## QueryBuilder `color-tokens.ts` Reconciliation

`QUERY_BUILDER_COLOR_TOKENS` in `src/QueryBuilderV2/color-tokens.ts` references CSS vars (`var(--qb-*-*)`) that remain identical between the mock and existing tokens. **No changes required.** The QB palette and the new `--member-pill-*` tokens both derive from the same `--qb-*` base vars, so they stay in sync automatically.

Tokens in `QUERY_BUILDER_COLOR_TOKENS` that have no equivalent in the mock (i.e., mock does not use a `filter` member type in its pills):

| Token | Status |
|---|---|
| `@filter-{strong,text,active,hover}-color` | Keep — used by PlaygroundV2 filter pills; not in scope for Segments |
| `@missing-{strong,text,active,hover}-color` | Keep — used by PlaygroundV2; not in scope for Segments |

## Dark-Mode Coverage

The mock (`~/Downloads/cube-segment/`) is light-only. The `/segments` routes will be scoped to light theme in v1. Existing screens continue to support dark mode via `:root[data-theme="dark"]` overrides. The new segment tokens have no dark-mode equivalents — acceptable for v1; document for future dark-pass.

## Files Changed

| File | Change Type |
|---|---|
| `src/theme/tokens.css` | Added 26 new tokens; updated `--radius-pill` to `9999px` |
| `src/pages/Segments/visuals/visuals.module.css` | New — shared primitive CSS (refs tokens only) |
| `src/pages/Segments/visuals/live-badge.tsx` | New primitive |
| `src/pages/Segments/visuals/member-pill.tsx` | New primitive |
| `src/pages/Segments/visuals/tag.tsx` | New primitive |
| `src/pages/Segments/visuals/selection-bar.tsx` | New primitive |
| `src/pages/Segments/visuals/kpi-tile.tsx` | New primitive |
| `src/pages/Segments/visuals/breadcrumbs.tsx` | New primitive |
| `src/pages/Segments/visuals/composition-card.tsx` | New primitive |
| `src/pages/Segments/visuals/predicate-pill.tsx` | New primitive |
| `src/pages/Segments/visuals/live-banner.tsx` | New primitive |
| `src/pages/Segments/visuals/floating-live-chip.tsx` | New primitive |
| `src/pages/Segments/visuals/line-chart.tsx` | New chart wrapper (recharts) |
| `src/pages/Segments/visuals/bar-list.tsx` | New chart wrapper |
| `src/pages/Segments/visuals/donut.tsx` | New chart wrapper (recharts) |
| `src/pages/Segments/visuals/sparkline.tsx` | New chart wrapper (recharts) |
| `src/pages/Segments/visuals/index.ts` | New barrel export |
| `src/pages/Segments/visuals/__tests__/visual-primitives.spec.tsx` | New unit tests |
