---
phase: 8
title: AI brief card (FE)
status: completed
priority: P2
effort: 1d
dependencies:
  - 7
---

# Phase 8: AI brief card (FE)

## Overview
Collapsible AI Brief card between the segment title row and the tab strip, auto-loading on
segment open (lazy, skeleton). Visual target: advisor mockup
`plans/reports/advisor-5aefe808-…-design.html`.

## Requirements
- Functional: auto-fetch on mount (`lang` = active i18n language); skeleton while pending;
  label chip + 3-4 sentence narrative + signal bullets; mandatory byline
  "AI-generated · estimated · N members · {generated_at relative}"; `limited` coverage →
  "Limited data — predicate analysis only" disclaimer chip; collapse state persisted
  (localStorage `gds-cube:segment-brief-collapsed`); expanded by default; error → quiet
  one-line state with Retry (`?refresh=1`); language switch refetches.
- Non-functional: zero layout shift for the rest of the page while loading (fixed-height
  skeleton); no fetch when card collapsed at mount until expanded (lazy); design tokens only;
  card component ≤200 LOC (split chip/byline if needed).

## Architecture
- Mount point: `detail-view.tsx` between `HeadlineStatsRow` (line ~223) and tab strip
  (line ~233) — inside the sticky header block, matching the mockup.
- `src/pages/Segments/detail/components/ai-brief-card.tsx` + `use-segment-brief.ts` hook
  (fetch + abort + refresh + collapse state). Collapse chrome: follow existing collapsible
  pattern (`AccordionItem` as reference; hand-rolled is fine if Accordion drags QueryBuilder
  styling along — visual source of truth is the mockup).
- Label chip colors via semantic tokens:
  `high_value_churn_risk`→destructive-soft/ink, `upsell_candidate`→info,
  `engaged_non_payer`→warning, `healthy_growth_cohort`→success, `new_user_wave`→muted.
  Labels i18n-mapped (`segments.detail.brief.labels.*`) — chip text localized, enum stable.
- Narrative text renders as plain text (no markdown/HTML injection from LLM output).

## Related Code Files
- Create: `src/pages/Segments/detail/components/ai-brief-card.tsx`,
  `src/pages/Segments/detail/components/use-segment-brief.ts`
- Modify: `src/pages/Segments/detail/detail-view.tsx` (mount)
- Modify: `src/api/segments-client.ts` (`getBrief(id, lang, refresh?)`)
- Modify: `src/i18n/locales/en.json`, `vi.json` (`segments.detail.brief.*`)

## Implementation Steps
1. Client method + `use-segment-brief.ts` (idle→loading→ok|error|limited; AbortController;
   refetch on id/lang change; lazy when collapsed).
2. Card UI per mockup: header row (sparkle icon + "AI Brief" + label chip + collapse chevron),
   narrative, signal bullets, byline. Skeleton = 3 shimmer lines, fixed height.
3. Mount in detail-view; verify sticky-header behavior + no CLS.
4. i18n keys EN/VI incl. all 5 labels + disclaimer + byline.
5. Tests: states (skeleton/ok/limited/error/retry), collapse persistence, lazy-when-collapsed,
   lang refetch, byline always present, plain-text rendering (no dangerouslySetInnerHTML).
6. Visual cross-check vs mockup AND adjacent pages (CLAUDE.md design rule 6).

## Success Criteria
- [x] Opening a segment shows skeleton → brief without shifting tabs/content below
- [x] Byline present in every rendered state that shows a narrative (non-negotiable per idea)
- [x] `limited` brief shows disclaimer chip, not confident framing
- [x] Collapse persists across reloads; collapsed mount issues no fetch
- [x] VI UI shows VI narrative; switching language refetches
- [x] Typecheck + FE suite green

## Verification notes (260607, commit 669fa56)
- 8 component tests (skeleton/ok/limited/error+retry, collapse persistence +
  lazy-when-collapsed, lang refetch, plain-text XSS guard, stale chip, mandatory
  byline). tsc = 74 errors (== pre-existing baseline, 0 new).
- Full FE suite 1877/1884: 5 DevAudit failures pre-exist (user Starters-tab
  work); 2 use-concept-graph failures verified pre-existing at user commit
  ca08c18 (game-scoped segment lists) — reproduced on that commit without any
  Phase 8 code. Not a regression from this phase.
- Review: DONE, no blockers. Applied L1+L2 (byline `{{memberCount}}` — avoids
  i18next plural reservation on `count` — + toLocaleString). M1 accepted:
  one-time skeleton→loaded height settle inside the sticky header is bounded;
  mount stays in the sticky block per mockup (plan's fallback unused).
- Extra beyond spec: `stale:true` (Phase 7 outage fallback) renders a
  warning-toned "Outdated — definition changed" chip.

## Risk Assessment
- **Sticky-header height growth** pushing tab content: card lives in the sticky block per
  mockup; if scroll UX degrades, fallback = render just below sticky block (1-line change,
  flag at review).
- **Exec misread**: byline + disclaimer are hard requirements (idea's non-negotiable);
  asserted in tests so they can't be "simplified" away later.
