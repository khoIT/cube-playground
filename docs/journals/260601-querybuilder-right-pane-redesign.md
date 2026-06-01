# QueryBuilder Right-Pane Redesign Shipped

**Date**: 2026-06-01 19:03  
**Severity**: Medium  
**Component**: QueryBuilderV2 layout, Compare feature  
**Status**: Complete  

## What Happened

Right pane reorganized from a single "Chart" panel into a three-tab shell (Chart / Analysis / Compare). Analysis moved OUT of the center tab strip; Compare moved OUT of the center toolbar. Per-row Δ/Δ% delta columns removed from the Results table (compare now exists only in the right pane). Game picker narrowed to only games whose Cube schema resolves locally (fixes cross-game schema mismatches appearing in prod).

## The Brutal Truth

This was a UX pivot: delta columns were handy for quick scanning, but putting compare in the right pane lets users toggle between query results and comparison side-by-side without constantly reshuffling the table. The trade-off is muscle memory loss—users who relied on inline deltas now have to flip to the Compare tab. Given the spec, it was the right call; the resistance is just cognitive friction.

The schema-readiness gate was overdue. Prod was shipping phantom games (cros / CrossFire PC) because the local picker had no way to validate what Cube schemas actually existed. Now it calls `GET /api/workspaces/:id/games-readiness` (60s cached)—lightweight, fail-open, no auth breakage.

## Technical Details

**Files shipped:**

- `src/QueryBuilderV2/components/right-pane-tabs.tsx` — New tabbed shell (100 loc) wrapping Chart / Analysis / Compare as enum-keyed views.
- `src/QueryBuilderV2/compare/compare-pane.tsx` — New Compare tab (343 loc): segmented mode toggle (`Off | PrevPeriod | OtherGame`), grouped-bar viz, per-measure N/A flags for schema gaps (e.g. "mf_users absent on ptg/muaw").
- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — Layout refactor: CompareContext.Provider moved from wrapping just center to wrapping entire layout; right pane widened 420 → 460px; center Compare toggle + Analysis tab stripped.
- `server/src/services/workspace-readiness.ts` — New: infers game → Cube workspace mapping, validates schema slice (checks for at least one measure), returns result map.
- `server/src/routes/workspaces.ts` — New GET `/api/workspaces/:id/games-readiness` endpoint; 60s Redis TTL, caches per workspace, silently fails to full list on cache miss.

**Tests:**
- `compare-pane.test.tsx` (103 loc): mode toggle, N/A note rendering, bar heights.
- `workspace-readiness-route.test.ts` (46 loc): verify workspace resolve, schema check, happy + sad paths.
- `compare-toggle.test.tsx`, `compare-wiring.test.tsx` updated for new context signature + seg button restyling (antd Radio → tokens).
- Deleted `compare/format-delta.ts` + test (110 loc orphaned); format logic now inline in the bar renderer.

**Verification:**
- tsc clean on all touched files (`QueryBuilderInternals.tsx`, `ChartSidePane.tsx`, `use-game-context.ts`, etc.)
- 418/418 QueryBuilderV2 frontend tests pass (vitest).
- 5/5 workspace-readiness route tests pass (server).
- No type regressions; URL routing for compare mode preserved.

## What We Tried

1. Keep delta columns visible + add a right-pane Compare panel → Rejected. Product said compare is a "modal" interaction; table delta noise undermines the right pane's clarity.
2. Game picker client-side filtering (hardcode known games) → Rejected. Schema drift (measures added/removed) means stale lists. Server-side with caching is the source of truth.
3. Cache readiness per game, not per workspace → Rejected. Games can be added/removed; per-workspace TTL captures that change gracefully.

## Root Cause Analysis

Why was Compare split across two surfaces before?
- Original design didn't anticipate how heavily users relied on cross-game comparison. Deltas in the table were a quick exploratory tool, but a dedicated pane is cleaner.

Why did the game picker ship with phantom games?
- use-game-context.ts was reading from a static workspace metadata object that didn't reflect Cube schema reality. No schema validation gate existed. This was a data freshness problem masquerading as a picker issue.

## Lessons Learned

1. **Schema validation gates belong at the source.** A picker that returns unmappable games is worse than a slow picker—it silently breaks downstream code. The readiness endpoint is the right place.

2. **UX pivots require clear trade-off framing.** Removing delta columns feels like regression until you see the right-pane Compare tab. In handoff docs, state the before/after explicitly: "Deltas moved to right pane Compare tab; table now read-only data view."

3. **Orphaned code is easy to miss.** format-delta.ts lived for 2 weeks after delta columns were removed because the deletion wasn't automatic. Add a linting rule or CI check to flag unused imports/exports in `compare/*` subdirs.

4. **CompareContext provider placement matters.** When wrapping the center column only, the right pane has no compare state and can't react to toggles. Moving the provider to wrap the whole layout (QueryBuilderInternals) was the untangling point—pay attention to context nesting depth.

## Next Steps

1. **Cross-game measure name collision risk (out of scope this round):** If two games define the same logical measure under different physical prefixes (`gvn.revenue_vnd` vs `vn.revenue_vnd`), the N/A flagging may be false-positive. Requires cube-member-resolver integration to normalize names. Document this as "known limitation" in Compare tab tooltip.

2. **Readiness cache invalidation strategy:** Currently 60s TTL. Add a manual refresh button in Settings (or tie to workspace edit hooks) if games are expected to change frequently.

3. **Monitor production adoption:** Track right-pane tab click-through (especially Compare tab) in analytics. If delta column usage was high, users may struggle during the transition period. Consider a one-time banner hint.

**Unresolved questions:**
- Should the Compare tab be sticky (persist across queries) or reset when the query changes? Currently it resets. Spec didn't clarify.
- Is 60s readiness cache sufficient, or should it be 300s? No perf test on the endpoint under load yet.
