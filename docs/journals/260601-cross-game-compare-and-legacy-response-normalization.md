# Cross-Game Compare & Legacy Cube Response Normalization

**Date**: 2026-06-01 20:30  
**Severity**: High  
**Component**: Compare pane (compare-by-dim-key merge logic); Dashboard tiles (response shape normalization)  
**Status**: Resolved

## What Happened

Two independent fixes shipped back-to-back:

1. **Cross-game compare for non-paired & empty results** (commit ce52f83): User tried comparing a recharge top-10 payers query across games (dimensions: user_id, role_name; measure: revenue_vnd). Comparing vs CFM returned a blank comparison column; comparing vs Metal Slug Awakening showed misleading empty bars instead of a "no data" signal.

2. **Pinned dashboard tiles render legacy Cube responses** (commit 8f6d302): Pinned chart parity feature (shipped earlier) never actually engaged — every tile fell back to legacy rows-based renderer. Root cause: response-shape mismatch between what ChartRenderer expected and what the cached Cube backend returned.

## The Brutal Truth

### Cross-game compare
The entire premise broke when dimensions don't align across games. A LEFT JOIN on {user_id, role_name} against CFM (which lacks role_name in its schema) matched zero rows, so the comparison side simply vanished. Metal Slug Awakening was worse: it had all members but zero rows in the date range, so the no-overlap detector missed it → the pane rendered paired bars with empty "—" instead of telling the user "no data for this game in this window." A user staring at an empty right column has no signal. That's a silent failure.

### Dashboard tile response shape
The pinned-chart parity feature shipped a handler (`isRenderableLoadResponse`) that only recognized the WRAPPER shape (`{results:[{data,annotation}]}`). But the Cube backend ALSO returns legacy single-result responses (`{data, annotation, query}` at top level). Every real cached tile hit the rejection → silent fallback to flat bars. The feature shipped but never fired. For 2+ weeks, pinned tiles were broken without anyone knowing.

## Technical Details

### Cross-game compare

**Root cause chain:**
- `merge-by-dim-key.ts` performs a LEFT JOIN using normalized dimension keys from the query. If user_id is disjoint across games (different players in each), zero rows pair.
- CFM schema missing `recharge.role_name` → compare query drops it at parse time → comparison result has fewer columns → JOIN on {user_id, role_name} vs {user_id} with nulls in role_name → no match.
- Metal Slug Awakening: comparisonRowCount===0 (no recharge data), but the no-overlap detector only fires when `comparisonRowCount > 0 && matchedRowCount === 0`. Zero rows at the gate, false negative → fell through to paired-bars logic with empty data.

**Solution** (all under `src/QueryBuilderV2/compare/`):
- **merge-by-dim-key.ts**: Added `computeOverlap(current, comparison, dimKeys)` → `{comparisonRowCount, matchedRowCount}`. Uses the SAME normalized key as the merge JOIN, so counts can't drift. Critical: counts are computed before/after the JOIN using identical logic.
- **use-compare-results.ts**: `runCompareLoad` now flags `noDimensionOverlap` when `comparison has rows but zero matches AND query has dimensions`. Threads `noDimensionOverlap` + raw `comparisonRows` through `CompareResultsState` and compare-context default.
- **compare-pane.tsx**: Three distinct outcomes replace the old empty-bars logic:
  1. **No dimension overlap** (comparison returned rows but none matched): Render each game's TOP-N leaderboard side by side, independently ranked, NOT paired. Include a heads-up note explaining the mismatch (wording adapts for "game vs previous-period" context).
  2. **Comparison empty** (target returned 0 rows): Derive a "{game} has no data for this query in the selected range" note directly from `comparisonRows.length === 0` + `unavailableMeasures`. No extra state field.
  3. **Measure missing**: Existing N/A note path. Measures-only queries always pair → paired grouped-bar view.

**Tests**: Compare suite 81/81 green. Added `computeOverlap` unit tests, `runCompareLoad` assertions for `noDimensionOverlap` flag + `comparisonRows` presence, and 2 `ComparePane` render tests (side-by-side leaderboards with independence note; empty-comparison note). TypeScript clean.

### Dashboard tiles: legacy response normalization

**Root cause chain:**
- Pinned-chart-parity shipped with `isRenderableLoadResponse(resp)` checking for shape `{ results: [{ data, annotation }] }`.
- Cube backend also emits legacy shape: `{ data, annotation, query }` (single result at top level, no results[] wrapper).
- Real cached tiles have the legacy shape → precheck rejects them → silent fallback to lightweight rows-based renderer. Feature never fires.
- The parity feature is CORRECT; the shape assumption was too narrow.

**Solution** (`src/pages/Dashboards/tile.tsx`):
- Replaced precheck with `normalizeLoadResponse(resp)`:
  - If `resp.results` exists (wrapper shape): pass through as-is.
  - If `resp.data && resp.annotation` (legacy single-result): LIFT into `{ queryType: 'regularQuery', results: [resp], pivotQuery: { ...resp.query } }`, return normalized shape.
  - Otherwise: return null (malformed).
- Callers consume the normalized shape uniformly. Fixes ALL existing cached tiles with zero re-pin/refresh.
- **Verified** against live cached tile: produces exact same 4 series + working chartPivot/seriesNames as QueryBuilder.

**Tests**: Added `tile-normalize-load-response.test.ts` (4 cases: wrapper shape, legacy single-result, missing annotation, null). Dashboards suite 18/18 green. Added entry to `lessons-learned.md`.

## What We Tried

### Cross-game compare
1. **Paired/rank-aligned approach**: Rejected — no common index across games (cfm has 1000 user IDs, metal-slug has 500; intersection is ~100). Ranked side-by-side defeats the purpose.
2. **Note-only approach** ("dimensions don't align"): Too vague. User wants to see the actual data; a warning without data is less useful.
3. **Side-by-side independent top-N leaderboards**: Accepted. User gets to compare without false alignment. Clearly signals "these are separate rankings."

### Dashboard tile response shape
1. **Tighten the precheck** (require wrapper shape, migrate all legacy responses): Rejected — would require a one-time cron pass to re-pin every cached tile. Invasive, error-prone.
2. **Try both shapes in the precheck** (if-else on presence of `.results`): Started here, but it left the normalization scattered in multiple places. Refactored into a single `normalizeLoadResponse` function for clarity.
3. **Normalize in place**: Accepted. One function, all callers use it, zero migration required. Legacy tiles auto-upgrade on next refresh.

## Root Cause Analysis

### Cross-game compare
The compare feature assumed "if we JOIN on the query's dimension keys, we get a coherent paired result." That assumption holds within a SINGLE Cube (same schema, same member space). Cross-game breaks it because:
1. Dimensions are logically the same (user_id) but physically disjoint (different players).
2. Schema divergence (CFM lacks role_name) → the dimension key set shifts between queries.
3. Empty results (Metal Slug) were treated as a non-condition in the detector logic.

The fix required making dimension-key joins OBSERVABLE — computing overlap counts using the EXACT same logic as the JOIN, so we could detect "JOIN succeeded but matched zero" separately from "comparison had no data."

### Dashboard tile response shape
The original design assumed all Cube responses follow one shape. They don't — the backend returns legacy single-result in some contexts (cached responses, older SDK versions). The code was correct (ChartRenderer reads `.results[0].data`); the assumption was wrong. Normalizing at the intake point (the `normalizeLoadResponse` function) isolates the shape variation and makes all downstream code uniform. The lesson: **adapter functions beat shape-specific conditionals**.

## Lessons Learned

1. **Cross-game analytics requires dimension-alignment visibility.** When merging results on keys that span multiple data sources, compute overlap BEFORE rendering. A matched-row count of zero is not a data absence — it's a schema or member-space mismatch. Expose it to the user.

2. **Side-by-side independent rankings beat false-alignment.** Top-N payers in game A vs. top-N payers in game B are two separate stories. The user doesn't need them paired on user_id (which may not even be the same person). Let each game's ranking stand alone.

3. **Normalization functions isolate shape variation.** If an external system (Cube) can return two shapes, a single adapter function (`normalizeLoadResponse`) at the intake point is cheaper than scattered shape checks throughout the codebase. Rename it from `isRenderableLoadResponse` to make the intent clear: this is a normalizer, not a validator.

4. **Response-shape assumptions silently fail.** The precheck worked; it just rejected shapes it wasn't built for. NO error, NO log, NO signal — the feature shipped and never fired. Add explicit logging (or a metric) when a precheck rejects a response that LOOKS valid but doesn't match the expected shape.

5. **Counts must use the exact same logic as the merge.** Overlap counts computed separately (e.g., "how many rows from comparison?" vs. "how many rows matched in the JOIN?") will diverge and mask bugs. Embed the counting logic INSIDE the merge function or call the same counting helper the merge uses.

## Next Steps

1. **Cross-game compare**: Monitor user feedback. If users want cross-game PAIRED comparison (e.g., ranked-by-metric or rank-window alignment), revisit the approach. Current solution (independent top-N) is a good starting point.

2. **Dashboard tile response shape**: Add a metric `tiles_normalized_response_shape` counter. If the legacy-shape path fires frequently in prod, it confirms the adapter is working. If it never fires (all shapes are already wrapper), we can deprecate the legacy path in 6 months.

3. **Empty-comparison message clarity**: Verify the "{game} has no data" message is visible enough in the UI. Consider adding a subtle icon or color to distinguish "no data for this game" from "dimensions don't overlap."

## Unresolved Questions

- Should cross-game compare support a "merged union ranking" mode (combining top-N from both games, re-ranking by metric)? Would require a second pass through the comparison logic. Shelve until customer request.
- Is the legacy Cube response shape ever used in NEW code, or only in cached responses? If only cached, we could deprecate it post-migration (6 months out). Verify with Cube team.
- Does the compare pane need a "explain why side-by-side" help tooltip, or is the wording sufficient?
