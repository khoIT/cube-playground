# Phase 02 — `list_dimension_values` tool

**Priority:** medium · **Status:** planned · **Depends on:** none (independent of phase 01)

## Overview

Thin, on-demand tool that returns the exact distinct values (correct casing) of
a low-cardinality dimension, so the agent stops guessing filter-value casing
(`whale` vs `Whale`).

## Key insights

- The whale turn spent reasoning on "is it `whale` or `Whale`?". A one-shot
  value lookup removes that class entirely.
- Reuse the `/load` fetch path from `preview-cube-query` — do not invent a new
  Cube client. Query = `{ dimensions: [member], measures: [<a count measure>],
  order: { <count>: 'desc' }, limit: N }`. If no count measure is resolvable,
  fall back to `{ dimensions: [member], limit: N }` (distinct via Cube).

## Requirements

- Tool `list_dimension_values({ member: string, q?: string })`:
  - Validates `member` is a real dimension via `resolveMemberMeta` (kind must be
    `dimension`/`timeDimension`); reject measures with a clear message.
  - Runs the `/load` query against `ctx.gameId`/`ctx.workspace`.
  - Optional `q` filters returned values case-insensitively (substring) to keep
    the payload small for the agent.
  - Caps rows (default 50); sets `truncated: true` + `cardinalityHint` when the
    cap is hit so the agent knows the dimension is high-cardinality and a value
    filter isn't the right move.
  - Returns `{ member, values: string[], truncated, count }`.

## Related code files

- Create: `src/tools/list-dimension-values.ts`.
- Modify: `src/tools/registry.ts` — register.
- Reference: `src/tools/preview-cube-query.ts` (the `/load` fetch + URL),
  `src/core/cube-meta-capability.ts` (`resolveMemberMeta` for validation).
- Create test: `test/tools/list-dimension-values.test.ts` (mock fetch).

## Implementation steps

1. Extract or replicate the minimal `/load` POST from `preview-cube-query`
   (URL `${config.serverBaseUrl}/cube-api/v1/load`, headers, error handling).
   If duplication is non-trivial, factor a small `loadCube(query, ctx)` helper
   both tools share (DRY) — decide during implementation, prefer no premature
   abstraction.
2. Build the count-measure-or-distinct query; map rows → unique values.
3. Apply `q` filter + cap; set `truncated`.
4. Register; test with mocked fetch returning a small value set + a capped set.

## Success criteria

- `list_dimension_values({member:'mf_users.payer_tier'})` returns
  `['whale', ...]` with real casing.
- High-cardinality dimension → capped result with `truncated: true`.
- `tsc --noEmit` clean; tests pass.

## Risks

- Accidental expensive scan on a huge dimension. Mitigate: hard row cap + the
  truncation signal; document in the tool description that it's for
  low-cardinality enums, not free-text columns.
