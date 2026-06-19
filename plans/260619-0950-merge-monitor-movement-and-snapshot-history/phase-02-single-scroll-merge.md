---
phase: 2
title: "Single-scroll merge + retire Movement tab"
status: done
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Single-scroll merge + retire Movement tab

## Overview
Recompose MonitorTab into the one-scroll "Now → Over time" layout, fold the Movement
sections in, de-dupe overlapping size/KPI cards, drop the Activation section, retire the
Movement tab + BETA badge, and degrade gracefully for snapshot-less segments.

## Requirements
- Functional: single tab renders, top→bottom — header (health + as-of + **View grain**) →
  NOW zone (size+delta, single **Track cadence** control [phase 1], slice-scope) → coverage
  strip → OVER TIME zone (KPI trends, membership movement, state distribution) → snapshot
  ledger slot (phase 3). View-grain owns the downsample for all OVER TIME sections (lifted
  state + the shipped re-clamp via `finestFullGrain`). **No Activation section.**
- Remove `movement` from the tab bar; `?tab=movement` deep-links redirect to
  `?tab=monitor`. Monitor stays default for ALL segments.
- Degrade: predicate+game → full surface; otherwise → NOW + refresh history, and ONE
  empty-state card replacing strip/OVER-TIME/ledger (per `merged-monitor-degraded.html`).

## Architecture
- MonitorTab becomes the orchestrator: owns `granularity` + `captureEras`/`finest` state
  (moved from MovementTab), computes `availability`, passes to header + sections.
- De-dupe rule: when snapshots exist (predicate+game), lakehouse cards are primary —
  `MembershipMovementSection` replaces `SizeTrendSection`; `KpiTrendSection` replaces
  `MetricMovementCard`. Snapshot-less → keep SQLite `SizeTrendSection`/`MetricMovementCard`.
  `TrajectoryCard` folds into the NOW size card (or stays as the size visual).
- MovementTab file is deleted; its child sections (`tabs/movement/*`) are reused as-is by
  MonitorTab (they're already standalone). `use-active-tab.ts`: drop `movement` from VALID,
  add `movement → {tab:'monitor'}` to LEGACY_MAP. `detail-view.tsx`: remove Movement tab
  injection + BETA badge + `tab==='movement'` render branch.

## Related Code Files
- Modify: `tabs/monitor-tab.tsx` (orchestrator), `detail-view.tsx` (tab list/render),
  `use-active-tab.ts` (legacy redirect), `segments.module.css` (zone eyebrows/layout)
- Delete: `tabs/movement-tab.tsx`
- Reuse (unchanged): `tabs/movement/{kpi-trend,membership-movement,state-distribution-trend}-section.tsx`,
  `cadence-coverage-strip.tsx`, `grain-availability.ts`
- Read: `tabs/monitor/{size-trend,refresh-history}-section.tsx`, cards (drop
  `activation-summary-section.tsx` from this tab; the Activation tab itself is unaffected)

## Implementation Steps
1. Lift granularity/captureEras/finest + availability into MonitorTab; render phase-1 header.
2. Lay out NOW zone (eyebrow) with de-duped cards; add slice-scope + single Track control.
3. Insert coverage strip as the spine; render OVER TIME sections gated on predicate+game.
4. Add the snapshot-less empty-state branch (degrade).
5. Remove Movement tab everywhere; add legacy redirect; delete movement-tab.tsx.
6. Update `tabs/__tests__` + any test referencing the Movement tab; build green.

## Todo List
- [x] MonitorTab orchestrator owns grain/eras/availability
- [x] NOW zone + de-dupe (lakehouse-primary / SQLite-fallback)
- [x] Coverage strip spine + OVER TIME sections
- [x] Degrade for snapshot-less segments — NOW = SizeTrendSection (SQLite size); OVER TIME =
      empty-state card per `merged-monitor-degraded.html`. (Plan originally said reuse
      MetricMovementCard, but that card is structurally game-bound — `isPredicateWithGame`
      guard — so it can never render for a snapshot-less segment; the empty-state is correct.)
- [x] Retire Movement tab + `?tab=movement`→monitor redirect + delete file
- [x] Tests + tsc green (no test referenced the tab wiring; movement section suites pass)

## Implementation note
Dropping the Activation section orphaned `ActivateToCdpModal` (its only trigger was the
section's "+ Activate to CDP" button). That modal is the legacy push-to-CDP flow that
`PullApiTab` (the Activation tab) explicitly "replaces" — so the orphaned wiring + the dead
`activation-summary-section.tsx` were removed; the Activation tab is unaffected. Reversible
if the quick push modal is still wanted.

## Success Criteria
- [ ] One scroll matches `merged-monitor-full.html`; degrade matches degraded mockup
- [ ] No size/KPI card rendered twice for any segment class
- [ ] `?tab=movement` old links land on Monitor; no dead tab
- [ ] Non-snapshot segments still fully usable (NOW + refresh history)

## Risk Assessment
- Blast radius: detail-view tab framework + BrokenSegmentBanner's `onViewRefreshLog`
  (still → monitor). Walk every `setTab('movement')`/`'monitor'` caller.
- View-grain state previously local to MovementTab → ensure re-clamp + window (days
  30 vs 14) logic ports intact.

## Security Considerations
- Movement sections already tokenless-read + redaction-gated; unchanged by relocation.
