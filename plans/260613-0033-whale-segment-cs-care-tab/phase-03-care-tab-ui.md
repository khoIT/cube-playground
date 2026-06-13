# Phase 03 — Care tab UI

## Overview
- **Priority:** P0
- **Status:** pending
- New **Care** tab on segment detail, gated to segments whose game has CS coverage. 4 widgets.

## Key insights
- Tabs live in `src/pages/Segments/detail/detail-view.tsx`: add `'care'` to `DetailTabId` + `BASE_TABS`
  (conditionally, only when `hasCsCoverage(segment.game_id)`), plus a render block.
- Mirror `insights-tab.tsx` structure + `segments.module.css`. **Design tokens only** (per design-guidelines):
  `var(--text-primary)`, `var(--border-card)`, `var(--bg-card)`, semantic status tokens
  (`--destructive-soft/-ink` for negative sentiment, `--warning-soft` for open, `--success-soft` for resolved).

## Requirements (4 widgets)
1. **Pulse header** — KPI chips: contacted X/N (coverage %), open/unresolved, negative-sentiment, ≤2-star.
   Coverage chip carries a tooltip: "Only in-game/web/phone tickets join; Facebook/AIHelp excluded."
2. **Issue mix** — horizontal bars by AI label category, colored by family (Payment/Account/Security emphasized).
3. **Risk watchlist** — table (reuse `member-table-shared.tsx` styling): name, LTV, last issue, sentiment chip,
   rating stars, status, days-since; row → existing member drill. Sorted by `riskScore`.
4. **CS-impact strip** — contacted vs non-contacted: pre→post recharge delta %, two mini bars/sparklines.
   Persistent caption: "Directional, small sample (n=…)." Hidden if `csImpact===null`.

## Related code files
- Create: `src/pages/Segments/detail/tabs/care-tab.tsx` + `care/` subcomponents (pulse, issue-mix, watchlist, impact-strip) — keep each < 200 LoC.
- Create: `src/api/segment-cs-care.ts` (typed fetch hook, `useQuery`).
- Edit: `detail-view.tsx` (tab registration + gating + render), i18n strings, `segments.module.css` if new classes.

## Implementation steps
1. API hook + types mirroring Phase 02 payload.
2. `care-tab.tsx` orchestrator + 4 child components, tokens throughout.
3. Register tab in `detail-view.tsx`, gated by `hasCsCoverage`; default-hide for non-covered games.
4. Empty/loading/degraded states (no coverage, Trino-slow spinner, csImpact-missing).
5. Cross-check visually against Insights tab (typography, padding, radius).

## Todo
- [ ] api hook + types
- [ ] care-tab + 4 subcomponents (tokens, < 200 LoC each)
- [ ] tab registration + gating in detail-view
- [ ] empty/loading/degraded states
- [ ] design cross-check vs adjacent page

## Success criteria
- Tab appears for jus_vn/cfm_vn segments, hidden elsewhere.
- Renders pulse + mix + watchlist + impact for `c03fd5c6…`; matches design system; no raw hex/px-font.

## Risks
- Drift from design system → copy from Insights/Members, don't re-derive.
- Slow endpoint → skeletons + "computing CS history" state, never a blank tab.
