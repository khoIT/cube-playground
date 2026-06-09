# Phase 3 — CS Monitor redesign around live editable segments

## Context links
- Monitor page: `src/pages/Dashboards/cs/index.tsx` (page header pattern, `canWrite`, `useCarePlaybooks`, `PortfolioStrip`, `PlaybookGrid`, `CsConsoleNav`).
- Grid: `src/pages/Dashboards/cs/playbook-grid.tsx` (4-group collapsible table; `RowKebab` Edit/Clone/Disable; CRITICAL invariant: unavailable rows fire ZERO queries).
- Strip: `src/pages/Dashboards/cs/portfolio-strip.tsx` (5 stat cards).
- Hook: `src/pages/Dashboards/cs/use-care-playbooks.ts` (registry + cases, NO cohort query; `ResolvedPlaybook`, `PlaybookCaseAgg`).
- Sweep snapshot store/route: `server/src/care/care-sweep-run-store.ts`, `GET /api/care/sweeps/runs` (`care-cases.ts:289`) — source of "latest per-segment match count" without a fresh Trino hit.
- Phase 1 endpoints: `preview-count`, `sweep?playbook=`.
- Design rules: `docs/design-guidelines.md`; page-header pattern fixed (eyebrow + icon + 20px/700 title, `padding 24px 32px`, `maxWidth 1320`, `margin 0 auto`).

## Overview
- Priority: P2. Status: pending.
- FULL redesign of the CS Monitor around live, editable segments. Per repo UI workflow, STATIC HTML DESIGN VARIANTS come FIRST; user picks before any React.

## Deliverable A (NO blocker) — design variants (static HTML)
- Produce 2–3 self-contained HTML mockups in `plans/260609-1654-cs-segment-live-count-sweep/visuals/`:
  - `variant-a-segment-cards.html` — segment-card grid grouped by NHÓM; each card shows name, priority, availability, live match count (big number), threshold summary, open/SLA mini-stats, inline "Count" + "Sweep" + "Edit" affordances.
  - `variant-b-dense-table.html` — evolution of the current table: adds a "Live matches" column + per-row Count/Sweep buttons + last-swept timestamp, keeps NHÓM grouping.
  - (optional) `variant-c-split.html` — left segment list + right detail pane (selected segment shows live count, condition preview, sweep history).
- Each mockup MUST use the design tokens via an inline `:root` token block copied from `src/theme/tokens.css` (so colors/radius/fonts match), `var(--font-sans)`, no raw hex in component styles. Reuse the portfolio strip at top.
- Show realistic NHÓM 1–4 grouping, available/partial/unavailable states (greyed), and a clear "live count requires a sweep/Trino query" affordance (not a number that pretends to be free).
- User reviews → picks one (or a mix). PAUSE for that decision before React.

## Deliverable B (blocked by Phase 1 + variant pick) — React implementation
- Implement the chosen variant. Likely touches:
  - `src/pages/Dashboards/cs/index.tsx` — swap `PlaybookGrid` for the chosen layout component; keep header/strip/nav.
  - New `src/pages/Dashboards/cs/segment-card-grid.tsx` (if card variant) OR extend `playbook-grid.tsx` (if table variant) — keep <200 lines; extract a `segment-row-actions.tsx` if needed.
  - Live-count source: a new `use-segment-counts.ts` hook that reads the LATEST sweep snapshot per playbook from `GET /api/care/sweeps/runs` (cheap, no Trino) for the "last known matches" number, AND offers an on-demand `count(playbookId)` calling `preview-count` for a fresh figure. Per-segment "Sweep" button calls `sweep?playbook=`.
- PRESERVE the critical invariant: unavailable segments fire ZERO live queries (no auto preview-count). Live numbers shown for unavailable rows come only from registry/snapshot (dashed/blocked), never an on-demand probe — and the on-demand Count/Sweep buttons are disabled for unavailable segments.
- Per-segment Count = explicit click (cold Trino); per-segment Sweep = explicit click, shows opened/lapsed, then refresh the snapshot count. Reuse `use-playbook-preview.ts` from Phase 2 (DRY — same `previewCount`/`sweepSegment`).
- Edit affordance routes to the builder (`/dashboards/cs/playbooks/:id/edit`) exactly as `RowKebab.handleEdit` does — reuse that routing (seed → `?base_id=`).

## Data flow
```
Monitor mount → useCarePlaybooks (registry + cases, NO Trino)
            → use-segment-counts: GET /api/care/sweeps/runs → latest matched per playbook (snapshot, no Trino)
[per-segment Count click] → preview-count (Trino, explicit) → fresh matched
[per-segment Sweep click] → sweep?playbook= (Trino + writes) → opened/lapsed → refetch snapshot
```

## Related code files
- Create: `visuals/variant-*.html`, `use-segment-counts.ts`, `segment-card-grid.tsx` (or `segment-row-actions.tsx`), monitor test.
- Modify: `index.tsx`, `playbook-grid.tsx` (if table variant chosen).
- Reuse: `use-playbook-preview.ts` (Phase 2), `portfolio-strip.tsx`, `cs-console-nav.tsx`.

## Implementation steps
1. Build 2–3 HTML variants in `visuals/`; PAUSE for user pick.
2. After pick + Phase 1 merged: `use-segment-counts.ts` (snapshot read + on-demand count).
3. Implement chosen layout component; wire Count/Sweep/Edit, gating unavailable.
4. Swap into `index.tsx`; keep header/strip/nav.
5. Test: render with mocked hooks; assert unavailable segments expose NO Count/Sweep affordance and fire no preview-count; assert Count click calls `previewCount`; assert Sweep click calls `sweepSegment` and refreshes.

## Todo list
- [ ] 3 HTML variants in visuals/ (tokens inlined)
- [ ] USER PICK (blocking gate)
- [ ] `use-segment-counts.ts`
- [ ] chosen layout component (<200 lines)
- [ ] wire into index.tsx
- [ ] monitor redesign test (unavailable-isolation + count/sweep wiring)
- [ ] tsc clean; visual cross-check vs Dashboards/Cohort

## Success criteria
- User-selected variant implemented; matches token system and page-header pattern.
- Each available segment shows last-known match count (snapshot) + on-demand Count + per-segment Sweep + Edit.
- Unavailable segments: greyed, no live query, no Count/Sweep affordance (invariant preserved).
- No regression to portfolio strip / nav / case-ledger entry points.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Auto-counting on mount hammers Trino (21 segments × cold) | M×H | Default to snapshot numbers (free); preview-count is explicit per-segment click only. |
| Unavailable-row query leak (breaks invariant) | M×H | Gate Count/Sweep on `availability !== 'unavailable'`; test asserts zero calls. |
| Variant drift from design system | M×M | Inline tokens from `tokens.css`; cross-check vs Dashboards/Cohort before React. |
| File >200 lines | L×L | Split into grid + row-actions + hook. |
| Snapshot count stale vs live | M×L | Label as "last swept {time}"; Count gives fresh figure on demand. |

## Security considerations
- Count/Sweep affordances editor/admin-gated (`canWrite`); viewers see read-only counts only.

## Next steps
Final review + full test pass (parent task #5).

## Consolidated open questions
1. Which variant (or mix) does the user pick? (Hard gate before React.)
2. Live count default source: latest sweep snapshot (free, possibly stale) vs auto fresh preview-count on mount (expensive)? Plan defaults to SNAPSHOT + explicit refresh — confirm.
3. Per-segment "Sweep" on the monitor: should it also live-refresh the open/SLA case stats inline, or rely on the next `useCarePlaybooks` refetch? (Plan: refetch cases after sweep.)
4. (Phase 1) Should a single-playbook sweep run be labeled `partial` in the sweep-run/trend store? (Carried from Phase 1.)
