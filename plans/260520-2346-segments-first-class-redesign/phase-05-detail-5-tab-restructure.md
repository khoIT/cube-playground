---
phase: 5
title: "Detail 5-tab restructure"
status: pending
priority: P1
effort: "2.5d"
dependencies: [2, 3, 4]
brainstormId: P3
---

# Phase 5 (P3): Detail 5-tab restructure

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §6
- Mockup: `../visuals/segments-first-class-mockup.html` — Detail screen
- Existing Detail: `src/pages/Segments/detail/{detail-view.tsx,tabs/*,cards/*,hooks/*}`

## Overview

Replace today's 7-tab strip (`overview / engagement / monetization / retention / sample-users / saved-analyses / predicate`) with **5 tabs**: `Monitor · Insights · Members · Definition · Activation`. Monitor becomes the **default** for ALL segments (not just preset-backed ones). Insights folds the four preset tabs into one tab with sub-pills. Members renames Sample Users. Definition surfaces the predicate + identity + refresh. Activation tab body (Phase 4 ships the shell) gets fully wired.

## Key Insights

- Monitor as default fixes today's UX where a non-preset segment lands on `sample-users` (a developer-feeling tab) instead of operational metrics.
- Insights tab reuses preset render logic via sub-pills — minimal new code, big IA win.
- Saved Analyses folds into Insights as a "Pinned analyses" strip at the bottom.
- URL params: `?tab=monitor` with mapping table for legacy `?tab=overview` → `?tab=insights§ion=overview` to preserve external deep-links.
- Activation tab body (now real, not just shell from Phase 4) renders `activations[]` with per-row push history + Activate CTA (button enabled in Phase 7).
- KPI strip stays on Detail (single-cohort dashboard is appropriate here) but compacted from ~100px → 72px height per mockup.

## Requirements

**Functional**
- Tab strip: 5 tabs in order — Monitor · Insights · Members · Definition · Activation.
- Default tab: `monitor`.
- URL persistence: `?tab=<id>` reflected on tab change; load reads URL on mount.
- Legacy mapping (mounted on Detail mount, before tab resolve):
  - `overview/engagement/monetization/retention` → `tab=insights§ion=<old>`
  - `sample-users` → `tab=members`
  - `predicate` → `tab=definition`
  - `saved-analyses` → `tab=insights§ion=saved`
- **Monitor tab** body:
  - Size trend section: headline `{count}` + delta vs last week + 7d chart (chart-1 orange line + area gradient), date-range selector (7d/30d/90d), export button.
  - Refresh history: 50-row table (segment → server bulk endpoint from Phase 3); columns: time-ago, status, uid_count, delta, view-diff link.
  - Activation summary: condensed list of `activations[]` (target + status + last_push_at) + `+ Activate to CDP` primary CTA opening push-modal in Activate tab (Phase 7).
- **Insights tab** body:
  - Sub-pill strip: Overview · Engagement · Monetization · Retention (only render pills for which preset has tab content; hide pills without content).
  - Reuse existing `PresetTab` component per sub-pill.
  - Bottom strip: "Pinned analyses" reusing `SavedAnalysesTab` content (compact).
  - Non-preset segments: show empty-state ("No insights for this cube — install a preset to enable.")
- **Members tab** body:
  - Reuse existing `SampleUsersTab` verbatim.
  - Add Export IDs button at top (was an action in detail header; move it here to declutter header).
- **Definition tab** body:
  - Reuse existing `PredicateTab` content.
  - Add Identity section: `cube`, `identity_dim` (preset-derived), refresh cadence chip.
  - Edit predicate button (already exists in header — keep duplicate inside tab for proximity).
- **Activation tab** body:
  - Full activation list: cards per `activation` (destination, env, metric_name, status pill, registered_at, last_pushed_at, last_error if failed).
  - Per-row actions: Re-activate (re-POST), Deactivate (DELETE), View MM-01 metric link.
  - `+ Activate to CDP` primary CTA (Phase 7 wires modal open).
- KPI strip stays at top, compacted to 72px height. Preserve preset `headlineKpis` rendering; fallback tiles unchanged (Size/Last refresh/Owner/Status).

**Non-functional**
- New file LOC ≤ 200. Modularize:
  - `tabs/monitor-tab.tsx` (orchestrator only) + `tabs/monitor/size-trend-section.tsx` + `tabs/monitor/refresh-history-section.tsx` + `tabs/monitor/activation-summary-section.tsx`.
  - `tabs/insights-tab.tsx` (orchestrator) + `tabs/insights/sub-pills.tsx`.
- Activation tab uses cards composed from Phase 4's `activation-tab.tsx` shell.
- Detail-view.tsx itself stays under 200 LOC post-refactor (extract tab-router into `detail/use-active-tab.ts`).

## Architecture

```
src/pages/Segments/detail/
  ├─ detail-view.tsx              — orchestrator only (≤200 LOC)
  ├─ use-active-tab.ts            NEW — URL ?tab= persistence + legacy mapping
  ├─ tabs/
  │   ├─ monitor-tab.tsx          NEW
  │   ├─ monitor/
  │   │   ├─ size-trend-section.tsx        NEW (chart + range select)
  │   │   ├─ refresh-history-section.tsx   NEW (50-row table)
  │   │   └─ activation-summary-section.tsx NEW
  │   ├─ insights-tab.tsx         NEW (orchestrator)
  │   ├─ insights/
  │   │   └─ sub-pills.tsx        NEW
  │   ├─ members-tab.tsx          NEW (thin wrapper of SampleUsersTab + Export)
  │   ├─ definition-tab.tsx       NEW (wraps PredicateTab + Identity)
  │   ├─ activation-tab.tsx       (extended from Phase 4 shell)
  │   ├─ sample-users-tab.tsx     KEEP — used by members-tab
  │   ├─ saved-analyses-tab.tsx   KEEP — used by insights-tab pinned strip
  │   ├─ preset-tab.tsx           KEEP
  │   └─ predicate-tab.tsx        KEEP — used by definition-tab
  └─ tab-pending-placeholder.tsx  DELETE (no longer needed — Monitor replaces empty preset fallback)
```

## Related Code Files

**Create**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/use-active-tab.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/monitor-tab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/monitor/size-trend-section.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/monitor/refresh-history-section.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/monitor/activation-summary-section.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/insights-tab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/insights/sub-pills.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/members-tab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/definition-tab.tsx`

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/detail-view.tsx` (slim to orchestrator; new tab IDs; default monitor; KPI 72px)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/activation-tab.tsx` (extend Phase 4 shell with real list rendering)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/segments.module.css` (`.detailKpiStrip` height + tab strip restyle)
- `/Users/lap16299/Documents/code/cube-playground/src/i18n/*` (new tab labels: monitor/insights/members/definition/activation; remove old 7-tab keys after legacy mapping verified)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/cards/kpi-card.tsx` (CSS height adjustment to fit 72px)

**Delete**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tab-pending-placeholder.tsx` (no longer referenced)

## Implementation Steps

1. **URL hook** — `use-active-tab.ts`: reads `?tab=` on mount; maps legacy IDs per Requirements; falls back to `monitor`. Exposes `[activeTab, setActiveTab]`.
2. **Monitor tab orchestrator** — `monitor-tab.tsx` (~80 LOC): renders 3 sections stacked.
3. **Size trend section** — Reuse refresh-log bulk endpoint from Phase 3 (or new single-segment variant `GET /segments/:id/refresh-log?days=30`). Render SVG line+area chart at 720×160. Headline = `segment.uid_count` formatted, delta computed from log first/last in range.
4. **Refresh history section** — Fetch 50 rows from refresh-log. Render as 5-col grid table (time-ago via `formatDistanceToNowStrict`, status pill, count, delta, view-diff link placeholder).
5. **Activation summary section** — Reads `segment.activations`. Renders condensed activation-row list + Activate CTA (button opens push-modal; modal `Activate to CDP` tab focus delegated to Phase 7).
6. **Insights tab orchestrator** — `insights-tab.tsx`: sub-pill state, render `<PresetTab>` for active sub-pill, pinned-analyses strip at bottom.
7. **Sub-pills** — Renders pills for `preset.tabs.filter(t => ['overview','engagement','monetization','retention'].includes(t.id))`. URL `§ion=<id>` persistence.
8. **Members tab** — Wraps SampleUsersTab + Export IDs button at top.
9. **Definition tab** — Renders Identity card (cube + identity_dim + refresh cadence), then existing PredicateTab content.
10. **Activation tab** — Extend Phase 4 shell: render per-activation cards, status pill, last-pushed-at, Re-activate / Deactivate buttons (Phase 7 wires real handlers).
11. **detail-view.tsx** — Strip TABS array to 5 IDs. Wire `useActiveTab` hook. Switch over new tab IDs. KPI strip wrapper unchanged.
12. **CSS** — `.detailKpiStrip` set height: 72px. `.tab` font-size kept 13.5px; spacing trim if needed. Add `.monitor-grid` + section card styles.
13. **i18n** — Add 5 new tab labels + sub-pill labels. Remove old tab IDs from translation files after smoke test.
14. **Delete** — `tab-pending-placeholder.tsx` after confirming no remaining import.

## Todo List

- [ ] `use-active-tab.ts` URL persistence + legacy mapping
- [ ] `monitor-tab.tsx` orchestrator
- [ ] `size-trend-section.tsx` (chart from refresh-log)
- [ ] `refresh-history-section.tsx` (50-row table)
- [ ] `activation-summary-section.tsx`
- [ ] `insights-tab.tsx` + `sub-pills.tsx`
- [ ] `members-tab.tsx` wrapper
- [ ] `definition-tab.tsx`
- [ ] Extend `activation-tab.tsx` with real list
- [ ] Slim `detail-view.tsx` to ≤200 LOC
- [ ] CSS: KPI strip 72px, tab restyle
- [ ] i18n new tab labels
- [ ] Delete `tab-pending-placeholder.tsx`
- [ ] Verify legacy `?tab=` redirects: open old URLs → land on new tabs

## Success Criteria

- [ ] Detail loads default Monitor tab for all segments (preset or not).
- [ ] Monitor tab shows size trend chart, refresh history, activation summary.
- [ ] Insights tab sub-pills only render pills with content.
- [ ] Members tab renders sample users + Export button.
- [ ] Definition tab renders identity + predicate.
- [ ] Activation tab renders per-activation cards.
- [ ] Legacy `?tab=overview` redirects to `?tab=insights§ion=overview`.
- [ ] KPI strip height = 72px.
- [ ] `detail-view.tsx` ≤ 200 LOC.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Refresh-log endpoint slow for 50 rows on segments with high refresh cadence | L | Index on `(segment_id, ts DESC)` from Phase 3; cap `days` param server-side to 30 |
| Sub-pill state vs URL param coupling fragile | M | Keep sub-pill state purely URL-driven (no React state shadowing); test browser back/forward |
| Insights empty-state for non-preset segments feels cold | L | Empty-state copy invites preset install: "No insights for this cube. Add a preset to enable." Link to docs |
| Activation tab rendering when `activations.length === 0` reads empty | L | Empty-state card with description matches Phase 4 shell |
| `tab-pending-placeholder.tsx` still referenced somewhere | L | Grep before delete; safe-delete |
| KPI 72px vs preset `headlineKpis` content overflow | L | KpiCard internal padding tightened; truncate value with title attribute |

## Security Considerations

- Refresh-log endpoint auth (same as detail page).
- Re-activate / Deactivate actions on Activation tab are stubs in this phase; real auth gating lands in Phase 7.

## Next Steps

Unblocks Phase 7 (Activate-to-CDP modal launches from Activation tab CTA). Phase 9 dark-mode pass audits all 5 tab bodies.
