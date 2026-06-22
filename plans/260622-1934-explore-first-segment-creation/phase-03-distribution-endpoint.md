# Phase 03 — Distribution endpoint (`POST /api/distribution`)

**Move:** 2 · **Priority:** P1 · **Status:** pending · **Service:** server

## Context
No histogram/distribution capability exists. `/api/preview` (`src/api/segments-client.ts:238`) already resolves a predicate + cube → count via the per-user grain; the distribution endpoint reuses its connector + grain discipline but returns a bucketed shape.

## Requirements
- `POST /api/distribution` body `{ primary_cube, measure, population_predicate?, buckets? }` → `{ buckets: [{ lo, hi, count }], total, p50, p90, took_ms, approx }`.
- Compute over the **per-user pre-agg grain** (e.g. `mf_users`), never the raw event mart.
- Default deciles (10 buckets) via `approx_percentile`; allow a fixed-width override. (Open question: deciles vs adaptive — deciles default.)
- Timeout-bounded + best-effort: on timeout return `{ approx: true }` with whatever resolved, or a clean 200 with `buckets: null` so the UI can fall back to a plain numeric input.

## Architecture
- New `server/src/routes/distribution.ts` (or fold into the preview route module). Build SQL via the same predicate→SQL + Trino connector path as preview/overlap.
- Cache keyed by `(cube, measure, predicate_hash, bucketing)` — distributions are stable within a refresh window; mirror preview's cache discipline.

## Related code
- Read: `server/src/routes/segments.ts` preview handler, `server/src/services/predicate-to-sql.ts`, `server/src/lakehouse/segment-overlap-counts.ts` (connector + count pattern).
- Create: distribution route + SQL builder + test.

## Implementation steps
1. Define request/response contract + zod schema.
2. SQL builder: bucket counts over the measure on the per-user grain, scoped by optional population predicate.
3. Timeout + cache + `approx` flag.
4. Tests: bucket sums == total; percentile sanity; timeout path returns fallback shape.

## Todo
- [ ] Contract + schema
- [ ] Bucketed SQL builder (deciles default)
- [ ] Timeout-bound + cache + approx flag
- [ ] Tests (sum invariant, percentile, fallback)

## Success criteria
- Returns a sane decile histogram for a known measure under timeout budget; `sum(bucket.count) == total`.
- Times out gracefully into a fallback shape, never a 500.

## Risks
- Latency on billion-row cubes → enforce per-user grain + timeout; the economy event marts are out of scope for this endpoint.

## Next
Phase 04 consumes this for the draggable cutoff UI.
