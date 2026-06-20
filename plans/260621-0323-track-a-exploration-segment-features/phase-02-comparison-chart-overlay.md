# Phase 02 — Comparison chart overlay (view toggle + indexed)

## Context links

- Plan: [plan.md](plan.md)
- Mockup: feature 2 (one overlaid chart; toggle overlaid · grouped · indexed).
- Combined tool: `chat-service/src/tools/emit-combined-artifact.ts`
- Chart render: `src/pages/Chat/components/assistant-chart-section.tsx`
- Chart type: `src/api/chat-sse-client.ts:64`
- Card menu: `src/pages/Chat/components/chart-section-menu.tsx`

## Overview

- **Priority:** P2.
- **Status:** done.
- **Description:** The `compare` skill should yield ONE overlaid chart with a
  view toggle — overlaid · grouped · indexed (indexed = rebase both series to 100
  at t0, client-side, for different-magnitude series). Build order #3 (FE-heavy).

## Key insights (verified)

- `emit_combined_artifact` (`emit-combined-artifact.ts:61`) ALREADY emits ONE
  combined artifact: it merges two cross-cube metrics on a shared date value and
  emits a single `dual-axis` `ChartSpec` (`:111`), with deterministic fallback to
  two cards when un-mergeable. So the "one chart instead of two stacked artifacts"
  half is DONE on the server. **The remaining work is FE-only.**
- The `compare` SKILL.md still says "emit two artifacts in sequence" for the
  two-subject path (`compare/SKILL.md:48`). Update guidance to prefer
  `emit_combined_artifact` whenever both subjects share a date axis (the tool is
  already in the skill's `allowed_tools`). This is a prompt/skill doc change, not
  code — low risk.
- The view toggle (overlaid / grouped / indexed) is a FE concern in
  `assistant-chart-section.tsx`. The chart already supports `dual-axis` (`:478`),
  `grouped-bar` (`:377`), `multi-line` and per-series rendering. "Overlaid" =
  multi-line/dual-axis on a shared axis; "grouped" = grouped-bar; "indexed" = a
  new client-side transform that rebases each series to 100 at t0 then renders as
  multi-line on a shared 0–N% axis.
- Override plumbing already exists: `overrideType` / `overrideEncoding`
  (`assistant-chart-section.tsx:88`, `query-artifact-card.tsx:51`). The toggle can
  reuse this rather than inventing new state — the "indexed" mode is the only
  genuinely new render path (needs a data transform, not just a type swap).
- Card-level menu is `ChartSectionMenu` (`query-artifact-card.tsx:125`). The
  3-way segmented toggle from the mockup can live in the card header next to / in
  place of the existing type menu for combined artifacts.

## Requirements

Functional:
- A combined/comparison artifact renders a 3-way view toggle: overlaid · grouped
  · indexed (segmented control, mockup styling, tokens only).
- overlaid → shared-axis multi-series (dual-axis or multi-line as today).
- grouped → side-by-side grouped bars.
- indexed → both series rebased to 100 at the first shared time point, rendered as
  multi-line; axis reads as index (100 = t0). Rebase is pure client-side on
  `spec.data`.
- Legend + caption per mockup; the "indexed" callout explains shape-vs-magnitude.

Non-functional:
- The toggle only appears for multi-series / combined specs (not single-series).
- Rebase handles zero/missing t0 gracefully (skip series with 0 base, disclose).

## Architecture

```
QueryArtifactCard (combined artifact)
  → header: ComparisonViewToggle (new) [overlaid | grouped | indexed]
  → on pick:
      overlaid → overrideType = 'dual-axis' | 'multi-line' (existing path)
      grouped  → overrideType = 'grouped-bar' (existing path)
      indexed  → transform spec.data via rebase-series-to-index, render multi-line
  AssistantChartSection renders the chosen view
```
Indexed transform (`rebase-series-to-index.ts`): for each series, divide every
point by that series' t0 value × 100; output a new `ChartSpec` (multi-line) over
the rebased rows. Pure function, unit-tested.

## Related code files

Create:
- `src/pages/Chat/components/comparison-view-toggle.tsx` — the 3-way segmented
  control (tokens, mockup styling).
- `src/pages/Chat/components/rebase-series-to-index.ts` — pure rebase transform
  (series → index-100-at-t0). Unit-tested.

Modify:
- `src/pages/Chat/components/assistant-chart-section.tsx` — support an "indexed"
  view: when active, render the rebased multi-line spec; keep overlaid/grouped on
  the existing override paths.
- `src/pages/Chat/components/query-artifact-card.tsx` — show
  `ComparisonViewToggle` for combined / multi-series artifacts and drive
  `overrideType` / an `indexed` flag from it.
- `chat-service/.claude/skills/compare/SKILL.md` — update the "Emit the
  artifact(s)" step to prefer `emit_combined_artifact` for two same-date-axis
  subjects (doc/prompt change). NOTE: `.claude/` change → conventional commit, NOT
  `chore`/`docs` type.

Delete: none.

## Implementation steps

1. **Rebase transform** — `rebase-series-to-index.ts`: given `spec.data` + series
   keys + the date key, produce index-100 rows; guard zero/missing t0.
2. **Toggle component** — `comparison-view-toggle.tsx`: segmented control,
   controlled value, tokens-only.
3. **Render wiring** — `assistant-chart-section.tsx`: accept an `indexed` view;
   when set, build the rebased multi-line spec; otherwise defer to overlaid/
   grouped via existing overrides.
4. **Card wiring** — `query-artifact-card.tsx`: render the toggle for combined /
   multi-series artifacts; map picks to override type / indexed flag.
5. **Skill guidance** — update `compare/SKILL.md` to prefer the combined tool.
6. **Verify** `npx tsc --noEmit` clean; run vitest (FE + chat-service if SKILL
   change is covered by a prompt test).

## Todo checklist

- [ ] `rebase-series-to-index.ts` pure transform
- [ ] `comparison-view-toggle.tsx`
- [ ] indexed render path in `assistant-chart-section.tsx`
- [ ] toggle wired in `query-artifact-card.tsx` (combined/multi-series only)
- [ ] `compare/SKILL.md` prefers `emit_combined_artifact`
- [ ] Tests + `tsc --noEmit` clean

## Success criteria

- A combined artifact shows a working overlaid · grouped · indexed toggle.
- "indexed" rebases both series to 100 at t0 so a 10× magnitude gap no longer
  flattens the smaller series (the trap called out in the mockup).
- Single-series artifacts do NOT show the toggle.
- `compare` skill produces one combined artifact (not two stacked) for two
  same-date-axis subjects.

## Tests to write

- `rebase-series-to-index`: two series at different magnitudes both start at 100;
  zero/missing t0 disclosed/skipped; ordering preserved.
- toggle: renders 3 options, controlled value changes drive the right spec.
- `query-artifact-card`: toggle shown for combined, hidden for single-series.

## Risks + mitigation

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Skill change shifts to combined-emit too aggressively | M×M | Keep the tool's existing static `canMerge` + post-load guards (already deterministic-fallback to two cards). |
| indexed with a missing/zero t0 | M×M | Guard: skip/normalize and disclose in caption. |
| Toggle leaks onto unsuitable single-series cards | L×L | Gate on multi-series / `combined` flag. |
| Override-state interplay with existing type menu | M×M | Reuse `overrideType`; add only the `indexed` view as the new branch. |

## Security / perf considerations

- Pure client-side transform; no new data fetch. No new endpoints.
- Tokens-only styling; no new inline hex.

## Next steps

- Independent of Phases 01/03/04. Server side already done — FE-only.
