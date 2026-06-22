# Phase 01 — Server dry-run count endpoint

## Overview
Priority: high (unblocks Phase 02). Status: pending.
Add an endpoint that returns the approximate member count for a candidate predicate tree, BEFORE a segment is saved.

## Mechanism (corrected after reading refresh-segment.ts)
The cohort size is NOT a raw `predicate-to-sql` Trino count — `refreshSegment` computes it via **Cube `/load` with `total:true`** (or a preset distinct-count measure). A dry-run MUST use the same path or the preview won't match the post-save size. Reuse the refresh building blocks:
`treeToCubeFilters(tree[, {resolvedPercentiles}])` → `resolveIdentityDetailed(cube, game)` → `loadWithContinueWait({ filters, dimensions:[identityField], total:true, limit:1 }, token)` → read `.total`. Resolve percentile leaves first via `resolveSegmentCutoffs(tree)` exactly as refresh does.

## Requirements
- Extract the size computation from `refresh-segment.ts` into a shared `computeSegmentSize({ cube, game, workspace, predicateTree | filters, cubeSegments? }) → { count }` so refresh and preview share ONE implementation (DRY — no second copy that can drift).
- `POST /api/segments/preview-count` body `{ game, cube, predicate_tree, cube_segments?, workspace? }` → `{ ok, estCount, tookMs }`.
- Timeout-bounded via the existing `PER_SEGMENT_TIMEOUT_MS` / env wait caps; transient Cube/Trino error → `{ ok:false, error:'timeout' }`. Structural (bad tree, uncohortable cube) → 400/`error` with message.
- Auth: game-scoped guard like other read routes.

## Related code
- Read: `server/src/jobs/refresh-segment.ts` (size logic to extract), `server/src/services/translator.ts` (`treeToCubeFilters`), `resolve-identity-field.ts`, `load-with-continue-wait.ts`, `segment-cutoff-resolver.ts`, `resolve-cube-token.ts`, `server/src/routes/segments.ts` (route + guards).
- Create: `server/src/services/compute-segment-size.ts`; refactor `refresh-segment.ts` to call it; add route in `segments.ts`.

## Success criteria
- Preview count for a known dimension predicate equals the size the segment shows after a real refresh (same mechanism → same number).
- Bad tree → 400 with message (not 500). Transient Cube outage → `ok:false` fast, never hangs.
- `refresh-segment` behavior unchanged (extraction is pure refactor; existing refresh tests still pass).

## Tests
- `compute-segment-size` with a mocked Cube loader → returns `.total`; percentile tree resolves cutoff first.
- route: valid → ok; invalid tree → 400; missing game → guard.

## Risks
Extraction must not change refresh semantics (size-measure preference, total:true fallback, transient-vs-structural error split). Keep the refactor behavior-identical; lean on existing `segment-refresh-ops` tests.
