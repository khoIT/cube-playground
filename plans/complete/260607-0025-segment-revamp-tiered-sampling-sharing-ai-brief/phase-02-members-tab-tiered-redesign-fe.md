---
phase: 2
title: Members tab tiered redesign (FE)
status: completed
priority: P1
effort: 1d
dependencies:
  - 1
---

# Phase 2: Members tab tiered redesign (FE)

## Overview
Redesign the Members tab (user mock, Image #1 baseline) around the three LTV tiers: a segmented
tier selector (Top 50 / Middle 50 / Bottom 50 by LTV), LTV column populated from stored tier
values, rows clickable through to the member-360 page, with a precompute-status affordance.
Fallback to today's random sample when tiers are absent.

## Requirements
- Functional: tier switcher; per-tier table (uid, LTV from tier data, enrichment columns via
  existing live path); search across the **full** uid list (unchanged); Export IDs unchanged;
  member-360 links for `hasMember360` games; "sampled 150 of N · as of <computed_at>" caption.
- Non-functional: design-guidelines compliance (tokens, no raw hex, spacing scale); no extra
  Cube queries for LTV (values come from `member_tiers_json`); file ≤200 LOC per module.

## Architecture
- `sample-users-tab.tsx` becomes a thin container: tier state + data source selection
  (tiers present → tiered view; absent → legacy random sample, kept as fallback component).
- New `tier-selector.tsx` (segmented control: Top/Middle/Bottom + counts; "All" when single
  `all` tier) and `tiered-members-table.tsx` (table keyed by active tier; LTV column sorted by
  rank from server, client-sortable on other columns of current page).
- Enrichment (Matches/Stage/Last active columns) still via `useMemberDimRows` with
  `uidsOverride` = active tier's uids (50 — same query size as today).
- "Reshuffle" button: hidden in tiered mode (tiers are deterministic); kept in fallback mode.
- Per-row cache chip (Phase 4 wires real status; this phase renders nothing if status absent —
  forward-compatible prop).

## Related Code Files
- Modify: `src/pages/Segments/detail/tabs/sample-users-tab.tsx` (split per modularization rule)
- Create: `src/pages/Segments/detail/tabs/tier-selector.tsx`
- Create: `src/pages/Segments/detail/tabs/tiered-members-table.tsx`
- Modify: `src/types/segment-api.ts` (consume tier types from Phase 1)
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/vi.json` (`segments.members.tiers.*`)

## Implementation Steps
1. Extend FE `Segment` type with `member_tiers` (nullable).
2. Build `tier-selector.tsx` — segmented control per design tokens (mirror tab-strip styling in
   `detail-view.tsx`; reuse semantic tokens; uppercase eyebrow caption "LTV sampling").
3. Build `tiered-members-table.tsx` — columns: #, uid (link), LTV (formatted currency from tier
   data), then existing `preset.memberColumns` enrichment columns.
4. Container logic in `sample-users-tab.tsx`: tiers → tiered view; else legacy sample (extract
   legacy to `random-sample-fallback.tsx` if LOC pressure).
5. Caption: "Top/middle/bottom 50 by LTV of N members · computed <relative time>"; search box
   continues to operate on the full uid list (existing behavior, both modes).
6. i18n EN/VI keys; visual cross-check vs Dashboards/Cohort pages per CLAUDE.md design rules.
7. FE vitest: tier switching, fallback rendering, LTV formatting, link presence per
   `hasMember360`, search override behavior.

## Success Criteria
- [x] mf_users predicate segment shows 3 tiers with LTV values, no extra Cube query for LTV
- [x] Manual / no-ltv segment falls back to current random sample UI unchanged
- [x] Search still matches the entire uid list, not just the 150
- [x] Tokens/spacing audit passes (no raw hex, header pattern intact)
- [x] Existing sample-users tests migrated/green (9 new tests; full FE 1787 pass, only 5
      pre-existing DevAudit failures confirmed on clean tree)

## Verification notes (260607)
- Built as: `member-table-shared.tsx` (extracted helpers), `tier-view-model.ts` (pure logic),
  `tier-selector.tsx`, `tiered-members-view.tsx`; `sample-users-tab.tsx` branches tiers→tiered
  view, else legacy `RandomSampleFallback` (faithful port, reviewer-diffed vs HEAD).
- Code review DONE_WITH_CONCERNS → fixed: display-only LTV-dedupe comment corrected; `#`-cell
  standardized on `--text-muted` (legacy used undefined `--text-tertiary`).
- Deferred (noted by review, non-blocking): registry guard test that preset `ltvMeasure` ∈
  `memberColumns` measures; per-row cache chip arrives with Phase 4.
- Test env quirks: no i18n provider in vitest → `t()` returns defaultValue WITHOUT
  interpolation (match /Top/, not /Top 50/); repo does not register jest-dom matchers
  (use toBeTruthy/toBeNull).

## Risk Assessment
- **Stale tiers vs live uid list** after partial refresh failure: caption shows `computed_at`
  so staleness is visible; tiers regenerate next refresh.
- **Column overflow** with LTV + enrichment columns: cap visible enrichment columns as today
  (preset-driven), horizontal scroll as last resort.
