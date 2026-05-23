---
title: "Hermes Shell Mirror"
description: "Mirror Hermes UI shell (sidebar 260/60 + rounded main + topbar) into cube-playground with zero functional regressions"
status: pending
priority: P1
branch: "main"
tags: [ui, shell, hermes, refactor]
blockedBy: []
blocks: []
created: "2026-05-23T04:44:41.894Z"
createdBy: "ck:plan"
source: skill
---

# Hermes Shell Mirror

## Overview

Port Hermes' chat-first IA shell (260px sidebar + rounded main + 56px topbar) into cube-playground. Approach A — inline-style shell + hybrid tokens. Cube's `--brand`/`--bg-card` vars + AntD overrides UNTOUCHED. Hermes `--hermes-*` vars coexist for `src/shell/*` only.

**Goal:** pixel-parity Hermes shell + Hermes-styled Segments library; zero functional regression on Playground, Catalog, Segment detail tabs, GamePicker, dark mode, SmartSearch, push-to-CDP.

**Inputs (read before any phase):**
- Brainstorm: [`../reports/brainstorm-260523-1054-hermes-shell-mirror.md`](../reports/brainstorm-260523-1054-hermes-shell-mirror.md)
- Phase 0 spec: [`phase-00-spec/README.md`](./phase-00-spec/README.md) — token-inventory, pixel-spec, port-manifest, font-audit, huashu-prototype

## Phases

| Phase | Name | Status | Est. |
|-------|------|--------|------|
| 1 | [Tokens & Theme](./phase-01-tokens-theme.md) | ✅ DONE | 20 min |
| 2 | [Stores & Utils](./phase-02-stores-utils.md) | ✅ DONE | 30 min |
| 3 | [Sidebar Primitives](./phase-03-sidebar-primitives.md) | ✅ DONE | 90 min |
| 4 | [Topbar Primitives](./phase-04-topbar-primitives.md) | ✅ DONE | 60 min |
| 5 | [Custom Sections & Sidebar](./phase-05-custom-sections-sidebar.md) | ✅ DONE | 60 min |
| 6 | [App Shell & Routes](./phase-06-app-shell-routes.md) | ✅ DONE | 45 min |
| 7 | [Segments Library Rewrite](./phase-07-segments-library-rewrite.md) | ⏸️ SCOPE-TRIMMED | 2-3 hr |
| 8 | [Segments Detail Restyle](./phase-08-segments-detail-restyle.md) | ⏸️ SCOPE-TRIMMED | 60 min |
| 9 | [Visual & E2E Validation](./phase-09-visual-e2e-validation.md) | ⚠️ PARTIAL | 90 min |

**Total est:** ~10 hr focused. **Actual:** 6 phases complete, 2 scope-trimmed, 1 partial (tests green, baseline deferred).

## Dependencies

Linear: each phase blocks the next. No external blocking plans.

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
```

Phase 9 may surface issues that reopen 1-8 (visual diff iteration loop).

---

## Follow-ups

**Phase 6 post-review fixes (COMPLETED):**
- CRITICAL #2: GamePicker overwrite race → moved into `<Topbar fixedTrailing={<GamePicker/>}/>`; GamePickerMount deleted.
- CRITICAL #1: cross-route topbar leakage → `useTopbarTrailing()` now takes `active` flag (default true); library-view + detail-view gate via `useRouteMatch`.
- HIGH #3: stale closure in DetailTopbarActions → deps widened to `[segmentId, uidCount, segmentType]`.

**Remaining (deferred for post-merge):**
- Phase 7: Filter-rail rewrite + goal-grouped rows → Deferred. Cube Segment has no `goal` field; existing filter pills work; brainstorm explicitly allows skipping unavailable features.
- Phase 8: KPI card / tab strip restyle → Deferred. All 5 tab bodies preserved functionally; visual polish can ship in follow-up.
- Phase 9: Hermes baseline capture suite → Deferred. Hermes must boot alongside cube (~600MB browser install, 30+ min setup). Manual visual smoke recommended before merge; Playwright integration can be post-merge.
