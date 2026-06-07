---
title: "Segment detail page UI redesign"
description: "Header/action-row redesign, compact KPI numbers, short-month chart axes, member360-style card headers."
status: pending
priority: P2
effort: 11h
branch: main
tags: [ui, segments, charts, design-tokens, formatting]
created: 2026-06-07
---

# Segment Detail Page UI Redesign

Three workstreams on the segment detail surface: (1) header/action-row + KPI strip
redesign, (2) number formatting (compact + exact tooltip), (3) chart datetime axes +
member360-style card headers. Design-first for the action row (HTML variants → user pick).

## Constraints (non-negotiable)
- Design tokens only (`var(--…)`), no raw hex. One font `var(--font-sans)`.
- Spacing scale: 4/6/8/10/12/14/16/20/24/32/48. Files < 200 LOC (modularize).
- No plan-artifact refs in code comments. Conventional commits.
- Pure, unit-testable format utils. vitest (`npm test`), tests in colocated `__tests__/`.

## Phases

| # | Phase | Status | Blocks |
|---|-------|--------|--------|
| 1 | [HTML design variants (header→KPI strip)](phase-01-design-variants.md) | pending | — |
| 2 | [Implement header/action-row + rename to Open in Playground](phase-02-header-action-row.md) | pending | P1 (user pick) |
| 3 | [Compact number formatting (B tier) + responsive KPI strip](phase-03-number-formatting.md) | pending | — |
| 4 | [Shared datetime axis formatter + wire charts](phase-04-datetime-axis.md) | pending | — |
| 5 | [Card-shell icon + unit chip redesign](phase-05-card-shell.md) | pending | — |
| 6 | [Tests + tsc build + code review](phase-06-tests-review.md) | pending | P3,P4,P5 |

## Dependency graph
- P1 → P2 (P2 cannot start until user picks a variant).
- P3, P4, P5 are independent of each other and of P2 (different files — see ownership below).
- P6 depends on P3, P4, P5 (and P2 if P2 lands before P6).

## File ownership (no overlap between parallel phases)
- P2: `detail-view.tsx`, `segments.module.css` (action-row classes), i18n `en.json`/`vi.json`.
- P3: `cards/format-value.ts`, `components/headline-stats-row.tsx`, `components/stats-row.tsx` + `stats-row.module.css`.
- P4: NEW `src/utils/format-chart-datetime-label.ts`, `visuals/line-chart.tsx`, `Chat/components/assistant-chart-section.tsx`, `cards/line-chart-card.tsx`.
- P5: `cards/card-shell.tsx` + 5 card callers + NEW icon resolver helper.
- Risk: P2 touches `segments.module.css`; P3 touches `stats-row.module.css` (separate file) — no collision.

## Key gotchas
- `copyAsFilter` key exists in BOTH `en.json:171` + `vi.json:148`; only used at `detail-view.tsx:201`. `saved-analyses-tab.tsx` does NOT exist — scout claim dropped `[UNVERIFIED]`.
- Chat charts use JS theme object `T` (not CSS vars) + 9 XAxis sites + tooltips — see P4.
- Dashboards inherit P4 fix free via shared `visuals/line-chart.tsx`.
