# Phase 04 — Card staleness "as of" signal

**Item:** (2) `segment_card_cache.fetched_at` is stored (ISO-Z) but the FE never shows it —
users can't tell a fresh tile from a 12h-old precompute. Closes the loop with the
naive-UTC→ISO-Z timestamp fix already shipped.
**Priority:** Medium. **Status:** ⬜ planned. **Layer:** FE. **Depends on:** Phase 02 (status), Phase 05 (manual decision).

## Context links
- src/pages/Segments/detail/cards/use-card-cache-lookup.ts (`getCachedRows` L14-19, `isCacheFresh` L21-25 — 15-min threshold, currently silent)
- src/pages/Segments/detail/cards/kpi-card.tsx (consumes cache L39-40 → `initialRows`, `skipBackgroundFetch`)
- src/pages/Segments/detail/tabs/preset-tab.tsx (passes `cacheKey` to every card L35-59)
- src/types/segment-api.ts (`CardCacheEntry { rows, fetched_at }` + Phase 02 `status/error`)
- Existing relative-time util: `formatDistanceToNowStrict` (date-fns), used in refresh-history-section.tsx

## Overview
Surface per-card freshness as a subtle, consistent affordance: a muted "as of {relative}"
caption (and an error hint when `status === 'error'`). Reuse the same `formatDistanceToNowStrict`
the Monitor tab uses, fed by the now-correct ISO-Z `fetched_at`. No new fetch — data already in
the hydrated `card_cache`.

## Key insights
- `isCacheFresh` already encodes the 15-min freshness rule; extend the lookup to also expose
  `fetchedAt` (string|null) + `status` so cards can render it without re-deriving.
- Affordance, not clutter: one small muted line per card footer (or a tooltip on a tiny dot).
  Design rule — use `var(--text-muted)`, 11px, `var(--font-sans)`; no new spacing constants.
- When `status === 'error'`: show "couldn't refresh · showing live data" (live FE fetch still
  runs via `useSegmentCubeQuery`), tone `--warning-ink`/`--warning-soft`.
- Live-fetched cards (no cache entry, e.g. manual segments per Phase 05) should read "live" —
  not a stale timestamp. Distinguish: cache hit → "as of X"; no entry → "live".

## Requirements
- Add a `CardFreshness` presentational element (tiny, tokenized) reused by KPI + chart cards.
- `use-card-cache-lookup` returns `{ rows, fetchedAt, status }` (or a sibling helper).
- Render: cache+ok → "as of {rel}"; cache+error → warning hint; no cache → "live".
- Tooltip shows absolute time (toLocale in viewer tz) for precision.

## Architecture
- New `src/pages/Segments/detail/cards/card-freshness.tsx` (< 60 LoC, styled-components or
  module CSS matching siblings).
- Extend lookup helper to surface `fetched_at` + `status` (keep `isCacheFresh` for the
  skip-background decision unchanged).
- Wire into kpi-card.tsx + the chart card wrapper in preset-tab.tsx (single shared component
  → DRY, one placement rule).

## Related code files
- Create: `card-freshness.tsx`
- Modify: `use-card-cache-lookup.ts`, `kpi-card.tsx`, chart card components / `preset-tab.tsx`
- Test: light RTL/unit on `card-freshness` rendering for ok / error / live states

## Implementation steps
1. Extend lookup to return `fetchedAt` + `status` alongside `rows`.
2. Build `CardFreshness` (props: `fetchedAt: string|null`, `status?: 'ok'|'error'`, `isLive: boolean`).
3. Place it in KPI + chart card footers; pass derived props.
4. Verify dark-mode tokens; cross-check against an adjacent card for visual fit.
5. Tests for the three states.

## Todo
- [ ] Lookup returns fetchedAt + status
- [ ] CardFreshness component (tokens, 11px muted)
- [ ] Wire KPI + chart cards
- [ ] States: as-of / error / live
- [ ] Dark-mode + adjacent-page visual cross-check
- [ ] Unit test states

## Success criteria
- Each precomputed tile shows "as of {N min ago}"; an errored tile shows the warning hint;
  a live-fetched tile reads "live". Tooltip gives absolute viewer-local time.
- No layout regression vs current Insights cards (compare to Dashboards/Cohort spacing).

## Risk assessment
- **Visual clutter** → single muted caption, reuse existing type scale; review against design-guidelines.md.
- **Depends on Phase 02 status** → if Phase 02 not shipped, gracefully treat missing `status` as `ok` (error branch simply never triggers).

## Security / Design
- Design tokens MANDATORY (this is a visible surface) — `--text-muted`, `--warning-*`,
  `--font-sans`, existing spacing scale only.

## Open questions
- Footer caption vs header dot+tooltip? (lean: muted footer caption — least intrusive, readable.)
