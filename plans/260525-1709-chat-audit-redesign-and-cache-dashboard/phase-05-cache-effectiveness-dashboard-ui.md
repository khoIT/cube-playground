# Phase 05 — Cache effectiveness dashboard UI

## Context Links
- Design: `design/hifi-mockup.html` (Cache tab section)
- Data layer: phase 04 (`/api/chat/debug/cache-effectiveness`)
- Theme: `src/shell/theme.tsx`
- Layout pattern reference: `src/pages/DevAudit/skill-leaderboard-page.tsx`

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Render the new cache-effectiveness dashboard at `/dev/chat-audit/cache`. Consumes the phase-04 endpoint. 4 hero metric cards + sparkline + top-20 table + stale ratio chip.

## Key Insights
- Single-page layout, scroll-y. No nested routes.
- Game + days filter mirror leaderboard's UX (re-use chip patterns).
- ONLY the "$ saved" hero stat may use a gradient accent (T.brand → T.brandHover). Everything else flat per anti-slop.
- Stale-cache pressure is informational, not blocking — show as small pill near top. Phase 06 decides if it deserves a banner alert.

## Requirements
**Functional**
- Hero stat: $ saved (giant mono numeral, gradient text fill).
- Hit rate: percentage + 7-day sparkline below.
- Tokens saved: big number, mono.
- Latency win: "Avg miss: X · Avg hit: Y → Z× faster" formatted line.
- Top-20 table: query snippet, skill, model, hit count, last hit, $ saved per row. Sortable by hit_count or dollarsSaved (client-side; backend already orders by hit_count).
- Stale chip: "12% stale · 4 legacy" — color: T.amberSoft bg when stale > 10%, T.surfaceSubtle otherwise.
- Days filter: 7 / 30 / 90 (default 30).
- Loading skeleton matching layout.
- Empty state: "No cache activity yet — first cached response will appear here."

**Non-functional**
- Each new file < 200 LOC.
- All numerics in T.fMono.
- No external chart lib — inline SVG sparkline (reuse from phase 03 if signature matches).

## Architecture
```
CacheDashboardPage (src/pages/DevAudit/cache-dashboard-page.tsx)
├── FilterBar (days select + game badge — small, shell already provides game context)
├── CacheDashboardHero (src/pages/DevAudit/cache-dashboard-hero.tsx)
│     ├── DollarsSavedCard (gradient text)
│     ├── HitRateCard      (sparkline inline)
│     ├── TokensSavedCard  (flat mono)
│     └── LatencyWinCard   (one-liner)
├── StaleRatioChip (inline component, <40 LOC, can live in hero file)
└── CacheDashboardTopQueries (src/pages/DevAudit/cache-dashboard-top-queries.tsx)
      └── table — query snippet, skill, model, hits, last hit, $ saved
```

**Hook:** `use-cache-effectiveness.ts` — single fetch with AbortController, parameters `{ gameId, days, topN }`. Refetch on dep change. Cache nothing client-side (KISS).

**Types:** `src/api/cache-effectiveness-types.ts` — shape mirrors phase-04 response. Exported from one place; FE pages import from here.

## Related Code Files
**Create**
- `src/pages/DevAudit/cache-dashboard-page.tsx` (~150 LOC)
- `src/pages/DevAudit/cache-dashboard-hero.tsx` (~120 LOC, hosts 4 cards + stale chip)
- `src/pages/DevAudit/cache-dashboard-top-queries.tsx` (~100 LOC)
- `src/pages/DevAudit/use-cache-effectiveness.ts` (~60 LOC)
- `src/api/cache-effectiveness-types.ts` (~40 LOC)

**Modify:** none in this phase (route mount is in phase 01 shell).

**Reuse**
- `skill-trend-sparkline.tsx` (phase 03) — same SVG component for hit-rate trend.

## Implementation Steps
1. Create types file mirroring phase-04 endpoint response shape.
2. Create `use-cache-effectiveness.ts`:
   - AbortController-based fetch (same idiom as `useDebugSession`).
   - Returns `{ data, isLoading, error }`.
   - Reset state on dep change.
3. Create `cache-dashboard-hero.tsx`:
   - 4 cards in CSS grid (4 columns desktop, wraps on narrow).
   - Card style: T.surface bg, 1px T.n200 border, padding 16px, no shadow.
   - `$ saved` numeral uses `background: linear-gradient(135deg, T.brand, T.brandHover); -webkit-background-clip: text; color: transparent;`. **ONLY here.**
   - Stale chip inline below hero grid.
4. Create `cache-dashboard-top-queries.tsx`:
   - Dense table, mono numerics, T.n200 row borders.
   - Sortable header (client-side; no backend resort).
   - Click row → expand inline to show full normalized query text + link to original turn (`/dev/chat-audit/sessions/<originalSessionId>#turn-<originalTurnId>`).
   - Truncate snippet at 80 chars with ellipsis.
5. Create `cache-dashboard-page.tsx`:
   - useActiveGameId() + local days state.
   - Renders FilterBar + Hero + TopQueries.
   - Loading → skeleton (gray bars matching layout).
   - Error → T.red500 text.
   - Empty (no data) → centered message.
6. Mount: route already wired in phase 01 (`/dev/chat-audit/cache` → `<CacheDashboardPage />`).
7. Add a "Refresh" tiny button (top-right of FilterBar) that bumps a tick to re-fetch — useful for verifying recent activity reflects.
8. Compile.

## Todo List
- [ ] `cache-effectiveness-types.ts`
- [ ] `use-cache-effectiveness.ts` (AbortController + tick refresh)
- [ ] `cache-dashboard-hero.tsx` (4 cards + stale chip)
- [ ] `cache-dashboard-top-queries.tsx` (sortable + expandable rows)
- [ ] `cache-dashboard-page.tsx` (controller + filter bar)
- [ ] Loading skeleton state
- [ ] Empty state
- [ ] Tooltip on `$ saved` explaining cost-equivalence caveat
- [ ] Compile

## Success Criteria
- Endpoint values render at correct positions per mockup.
- Sparkline matches hi-fi (thin orange, no axis).
- Gradient appears ONLY on $ saved numeral.
- Sort by hit count works client-side.
- Click top-query row navigates to original turn correctly.
- Empty state on fresh DB.
- Loading skeleton appears within 50ms of mount.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Endpoint slow (10s+) → unresponsive tab | Low | Med | Loading skeleton; phase 04 has < 50ms target |
| $ saved formula caveat hidden → user trusts it as gospel | Med | Med | Tooltip text under hero: "Estimate: original miss cost × repeat hits. Assumes hit cost ≈ miss cost." |
| Stale chip color triggers alarm fatigue at 12% baseline | Med | Low | Threshold tuneable in code; if baseline noisy, phase 06 ships heuristic banner only above 25% |
| Top-N table grows long when topN client-side filtered | Low | Low | Backend limit; phase 04 clamps topN [1,100] |
| Gradient text not rendered in Firefox/IE | Low | Low | `-webkit-background-clip: text` widely supported; fallback to T.brand solid via `@supports not (background-clip: text)` |

## Security Considerations
- All data flows through owner-scoped phase-04 endpoint. No new auth surface.
- Cross-owner leakage impossible by construction (FE has no way to call `?ownerId=other`).

## Next Steps
- Phase 06: stale-cache pressure banner (above threshold), cmd-K wiring, empty-state polish.
