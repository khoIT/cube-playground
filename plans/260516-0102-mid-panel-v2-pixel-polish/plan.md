---
title: "Mid-panel v2 pixel polish"
description: "Pixel-by-pixel align mid panel + chart pane to Cube Playground v2 standalone reference: inline pre-agg banner, refined Query card rows, chart-type toggle + Pivot/Code header, polished results card."
status: complete
priority: P2
branch: "main"
tags: [ui, refactor, design-system]
blockedBy: []
blocks: []
created: "2026-05-16T01:10:00.000Z"
completed: "2026-05-16T00:00:00.000Z"
createdBy: "ck:plan"
source: skill
---

# Mid-panel v2 pixel polish

## Overview

Tighten the QueryBuilder mid panel + chart pane to match Image #3 and the design specs extracted from `Cube Playground v2 (standalone).html` (1.8MB self-contained, 2026-05-16 01:02). Builds on the previous redesign (plan `260515-2330-pane-ui-redesign-modern-rounded`, status complete) which delivered the pane shell + rounded cards. This pass corrects per-element spacing, typography, and adds the missing chart-type toggle.

## References

- **Image #3** — Figma Make screenshot of target mid-panel.
- **Code reference** — `C:\Users\CPU12830-local\Downloads\Cube Playground v2 (standalone).html` (1.8MB).
- **Research reports**:
  - `plans/reports/researcher-v2-mid-panel-query-card.md` — tokens, .qrow, .m-pill, .add-pill, .preagg-banner, .live-dot specs
  - `plans/reports/researcher-v2-chart-and-results.md` — chart panel, tabs, table header, footer specs

## Key Deltas vs Current Code

| Area | Current | v2 spec |
|------|---------|---------|
| Pre-agg banner | Separate band below Run card | Inline right of Run button, same card |
| Query row label width | 110px | 88px |
| Query row gap | 12px | 14px |
| Query row border | solid `var(--border-card)` | dashed `var(--neutral-100)` |
| Pill bg | `var(--bg-muted)` | `#fff` |
| Pill padding | `2px 4px 2px 8px` | `0 8px 0 6px` (asymmetric, 28px tall) |
| Pill mono path | inline plain text | bg-tinted chip (`neutral-100`, 4px radius) |
| Add button border | dashed `--border-strong` neutral | dashed orange `rgba(240,90,34,0.4)` |
| Add label (TIME row) | "Add" | "Add time" |
| Remove-all button | ui-kit Button red theme | `.add-pill.danger` (red dashed, transparent bg) |
| Chart pane controls | header has only collapse btn | header: title left + Pivot/Code right; segmented Line/Bar/Area/Table below |
| Table header bg | `#dark-04.8` neutral tint | TBD: orange-soft `rgba(240,90,34,0.06)` — needs visual audit |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Tokens & spec alignment](./phase-01-tokens-spec-alignment.md) | Complete |
| 2 | [Run row + pre-agg inline](./phase-02-run-row-pre-agg-inline.md) | Complete |
| 3 | [Query card pixel polish](./phase-03-query-card-pixel-polish.md) | Complete |
| 4 | [Chart panel controls](./phase-04-chart-panel-controls.md) | Complete |
| 5 | [Results polish](./phase-05-results-polish.md) | Audit only (visual pass deferred) |
| 6 | [Verification](./phase-06-verification.md) | Complete |

## Dependencies

None. Extends completed plan `260515-2330-pane-ui-redesign-modern-rounded`. Internal-only refactor.

## Risk Summary

- **Member-type accent palette divergence** — v2 uses a single dark `#0a0a0a` left stripe; current uses per-member-type colors (`--chart-2..5`). Decision: **keep current per-type accents** — they're a UX win over v2's flatter look. Document this intentional divergence.
- **Pre-agg banner inline layout** — when the Run card is narrow (chart pane expanded), the banner may wrap or truncate. Mitigate with `flex-wrap` or move to second line on narrow widths.
- **PreAggregationAlerts internal shape** — current component may render its own card chrome; need to strip wrappers when used inline.
- **Chart-type toggle** — `setChartType` from context already exists; no plumbing risk. But existing chart-type selection UI inside `QueryBuilderChart` (Radio buttons) must be removed to avoid duplication.
- **Pivot/Code dialogs** — already wired via `DialogTrigger` in `QueryBuilderChart`. Just lift the triggers up to the pane header right-slot.

## Unresolved Questions

- **Table header tint** — researcher couldn't confirm orange-soft from the minified file. Phase 5 includes a visual audit step against Image #3 before deciding.
- **Pre-agg banner wrap behavior** at narrow widths — to be decided during Phase 2 implementation.

## Validation Log

(populated by `/ck:plan validate` or `/ck:plan red-team` if run)
