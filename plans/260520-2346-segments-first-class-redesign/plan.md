---
title: Segments first-class redesign (VNGGames Player Hub)
description: >-
  Re-skin to VNGGames Player Hub DS + introduce Game-Context as app-wide scope +
  restructure Segments lifecycle (define→monitor→activate-to-CDP). 9 phases.
status: pending
priority: P1
branch: main
tags:
  - segments
  - design-system
  - game-context
  - cdp
  - activation
  - ui
blockedBy: []
blocks: []
brainstorm: ../reports/brainstorm-260520-2311-segments-first-class-redesign.md
mockup: ../visuals/segments-first-class-mockup.html
created: '2026-05-20T16:48:09.891Z'
createdBy: 'ck:plan'
source: skill
---

# Segments first-class redesign (VNGGames Player Hub)

## Overview

Reframe `/segments` as the LiveOps lifecycle surface: **define → monitor → activate-to-CDP**. Introduce Game-Context as an app-wide scope, align tokens to VNGGames Player Hub DS, compact Library, restructure Detail (5 tabs incl. Activation), make Editor a workspace, ship CDP activation UI + data shape + MM-01 client stub. All decisions locked in brainstorm §15 + §17. **Backend CDP wiring deferred** to a later phase outside this plan.

Mockup: `../visuals/segments-first-class-mockup.html` (5 screens — App shell · Library · Detail · Push modal · Editor).

## Phase ID mapping (brainstorm § → CLI numbering)

| Brainstorm ID | CLI Phase | File |
|---|---|---|
| P0  | 1 | [Token audit](./phase-01-token-audit.md) |
| P0a | 2 | [Game-Context foundation](./phase-02-game-context-foundation.md) |
| P1  | 3 | [Library compaction + sparkline](./phase-03-library-compaction-sparkline.md) |
| P2  | 4 | [Activation data model + stub](./phase-04-activation-data-model-stub.md) |
| P3  | 5 | [Detail 5-tab restructure](./phase-05-detail-5-tab-restructure.md) |
| P4  | 6 | [Editor workspace](./phase-06-editor-workspace.md) |
| P5  | 7 | [Push-modal Activate to CDP](./phase-07-push-modal-activate-to-cdp.md) |
| P6  | 8 | [Catalog + NewMetric game-aware polish](./phase-08-catalog-newmetric-game-aware-polish.md) |
| P6.5| 9 | [Dark mode pass](./phase-09-dark-mode-pass.md) |
| P7  | — | Deferred. Separate brainstorm (Playground v3). |

## Phases

| Phase | Name | Status | Effort | Depends on |
|-------|------|--------|--------|------------|
| 1 | [Token audit](./phase-01-token-audit.md) | Completed | 0.5d | — |
| 2 | [Game-Context foundation](./phase-02-game-context-foundation.md) | Completed | 2d | — (parallel-safe with 1) |
| 3 | [Library compaction + sparkline](./phase-03-library-compaction-sparkline.md) | Completed | 2d | 1, 2 |
| 4 | [Activation data model + stub](./phase-04-activation-data-model-stub.md) | Completed | 1d | 2 |
| 5 | [Detail 5-tab restructure](./phase-05-detail-5-tab-restructure.md) | Completed | 2.5d | 2, 3, 4 |
| 6 | [Editor workspace](./phase-06-editor-workspace.md) | Completed | 2d | 2 |
| 7 | [Push-modal Activate to CDP](./phase-07-push-modal-activate-to-cdp.md) | Completed | 2.5d | 2, 4 |
| 8 | [Catalog + NewMetric game-aware polish](./phase-08-catalog-newmetric-game-aware-polish.md) | Partial | 1.5d | 1, 2 |
| 9 | [Dark mode pass](./phase-09-dark-mode-pass.md) | Completed | 0.5d | 1, 3, 5, 6, 7, 8 |

\* Phase 4's frontmatter marked `completed` but no migration 006 / `activations_json` / FE `activations[]` exists in code. Reverted-status text reflects ground truth.

Total: ~14.5 day estimate (single dev, sequential). Phases 4/6/7/8 parallelizable after foundation lands.

## Sequencing

```
1 (tokens) ─────────────────────────────────────────────────────┐
                                                                │
2 (game-context) ──┬─▶ 3 (library) ─┬─▶ 5 (detail) ─────────┐  │
                   ├─▶ 4 (activation stub) ─┘                │  │
                   ├─▶ 6 (editor)                            │  │
                   ├─▶ 7 (push-modal CDP) ───────────────────┤  │
                   └─▶ 8 (catalog polish) ───────────────────┤  │
                                                              ▼  ▼
                                                          9 (dark mode)
```

## Cross-plan dependencies

- **Related plan (not blocking):** `../260519-1610-query-results-to-segments/plan.md` — the original foundation plan that built the segments workspace this redesign builds on. Status flag is stale (P0–P8 actually shipped per commit log `72fa48c`/`8bf7fb7`/`ea17913`). No blocking relationship; this plan extends and re-skins what that plan built.

## Definition of done (plan-wide)

- Library above-the-fold ≤ 160 px (currently ~340 px)
- Every Library row shows lifecycle health at a glance (Fresh / Stale / Static / Broken)
- Every segment row shows destination chips OR a clear empty state
- Detail Monitor tab is the default landing for ALL segments (preset or not)
- Activate-to-CDP flow renders end-to-end (modal opens, validates, submits to MM-01 stub)
- Catalog + New Metric pass DS audit (pill buttons, sentence case, Lucide icons, no emoji)
- Game picker in Header scopes Library/Catalog/NewMetric to active game
- Dark mode renders without regressions across all touched surfaces

## Open questions (non-blocking, see brainstorm §16)

1. Playground v3 brainstorm timing (P7 deferred)
2. League Gothic confirmation — current default: skip, use Inter Semibold 20–24 px
