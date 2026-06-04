---
title: "Per-Member 360 Page (cfm v1)"
description: "Per-member 360 detail page reached from a segment's members tab, modeled on cfm-user360, served live from Cube."
status: pending
priority: P2
branch: "main"
tags: [segments, cube, frontend, cfm]
blockedBy: []
blocks: []
created: "2026-06-05T12:00:00.000Z"
createdBy: "ck:plan"
source: skill
---

# Per-Member 360 Page (cfm v1)

## Overview
New route `/#/segments/:id/members/:uid` rendering one cfm member's full 360 (all 26 `cfm/user_360.yml` views incl. event-stream panels), reached by clicking a member row in the Segments members tab. Data pulled **live** from cube-dev `/v1/load` via a new `useMemberCubeQuery` hook that reuses the existing bare↔prefix resolver. Config-driven panel registry → ~4 generic renderers. Event panels lazy-load behind a guardrail-aware (≤31d) "Behavior" section. cfm only in v1; config-driven so cros/tf/ballistar are a later config add.

Source design: `plans/reports/brainstorm-260605-per-member-360-page.md` (approved).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Hi-Fi Mockup](./phase-01-hi-fi-mockup.md) | Skipped — built the real page directly (strong existing design system; running page is the better artifact) |
| 2 | [Data Layer](./phase-02-data-layer.md) | Done — `use-member-cube-query.ts` + `member360-panels.ts` (per-game registry) + `build-panel-query.ts` + `format-cell.ts`; 17 unit tests |
| 3 | [Page + Core Panels](./phase-03-page-core-panels.md) | Done — `member-360-view.tsx` + `member-panel.tsx`; route + clickable uid wired |
| 4 | [Behavior Section](./phase-04-behavior-section.md) | Done — `behavior-section.tsx` + `behavior-date-range.tsx`; playerid bridge + ≤31d preset bound |
| 5 | [Polish + Verify](./phase-05-polish-verify.md) | Partial — tokens/tests/build green + code-review fixes applied; **in-browser value reconcile vs Trino/dashboard still pending** (standalone curl blocked by game-claim auth plumbing the in-app bootstrap handles) |

## Build notes (260605)
- **Substrate already present**: cfm `user_360.yml` (23 views incl. 10 event panels), `etl_*` cubes, and the cube.js ≤31d guardrail were already ported in-repo at `cube-dev/` (porting plan `260604-2317` Phases 1–11 = Completed). Verified on disk — NOT re-ported. (Earlier confusion was reading the sibling `cube-dev-old`, which lacks them.)
- **Per-game registry, not cfm-only**: built `cfm` (full, the locked v1 target) **+ `ballistar`** (core subset). Reason: every existing segment is ballistar — a strictly cfm-only page would be unreachable in the live app. Additive, honors the cfm-v1 lock; cros/tf are trivial later config entries (their `user_360.yml` exist).
- **Guardrail safety**: every behavior panel query carries an `inDateRange` bound on `<view>.log_date`; a test asserts the registry's behavior views ⊆ cube.js `BEHAVIOR_VIEWS` and that no unbounded query is constructable.
- **Code review** (DONE_WITH_CONCERNS): fixed i18n namespace (`segments.member360.*`) and profile KPI members now fetched. Open nit: `--text-tertiary` undefined project-wide (pre-existing, used by adjacent pages).

## Key decisions (user-locked)
- Surface: full route page (not modal/drawer).
- Scope: full 360 incl. event panels; cfm only v1; live Cube (no snapshot dep).
- PII (device_id/client_ip): shown, tagged "PII".
- Architecture: config-driven panel registry (Approach A).

## Dependencies
- **Soft overlap** with `260604-2319-segment-snapshot-pull-api` (both touch `src/pages/Segments/detail/tabs/`). No data dependency — this plan reads live Cube, not snapshots. Only shared file: `sample-users-tab.tsx` (we add clickable rows; their Phase 4 rewrites `activation-tab.tsx`, a different file). No hard `blockedBy`/`blocks`. Coordinate merge order if both land same week.
- Depends on the already-ported `cube-dev/cube/model/views/cfm/user_360.yml` + `cube.js` guardrail (shipped, commit 96ddbde).
