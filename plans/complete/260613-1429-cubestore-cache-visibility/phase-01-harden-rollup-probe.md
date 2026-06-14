# Phase 01 — Harden rollup probe to assert usedPreAggregations

Status: pending · Priority: high

## Goal

Green only when a rollup actually served. Add a 4th state for "200 but Trino passthrough".

## Change

`probeOne` already awaits the full `/load` body via `loadWithCtx` (returns `unknown`). Inspect the
resolved body's `usedPreAggregations` instead of treating every non-throw as built.

Classification:
- resolves + `usedPreAggregations` has ≥1 key → `built` (rollup active)
- resolves + `usedPreAggregations` empty/absent → `from-source` (served from Trino; rollup not routing)
- throws + message matches `PARTITION_NOT_BUILT_SUBSTRING` → `unbuilt`
- throws otherwise → `error`

## Files

- `server/src/services/preagg-readiness.ts`
  - `ProbeStatus = 'built' | 'from-source' | 'unbuilt' | 'error'`
  - `probeOne`: read `(body as {usedPreAggregations?: Record<string, unknown>}).usedPreAggregations`
  - `GamePreaggResult`: add `fromSource: number`; compute in the per-game reducer.
- `server/src/routes/preagg-runs.ts` — `/current` summary: add `fromSource` total.
- `server/src/services/preagg-run-collector.ts` — if it records probe-snapshot counts, include fromSource
  (check; keep additive — don't break existing sweep rows).
- `src/pages/Admin/hub/preagg-runs-data.ts` — `ProbeCubeResult.status` union; `GameReadinessSummary.fromSource`;
  `ServeabilityNow.summary.fromSource`.
- `src/pages/Admin/hub/preagg-readiness-matrix.tsx` — TONE add `from-source` (info/amber: `--info-soft/--info-ink`);
  legend dot; `toBuild = unbuilt + fromSource` (passthrough is build-fixable; errored stays infra, separate);
  built tally `g.built/total` unchanged.
- `src/pages/Admin/hub/preagg-runs-tab.tsx` — ServeabilityStrip: 4 pills (serving warm / from source / never built / error).

## Tests

- `server/test/preagg-readiness.test.ts` — classifier: body with `usedPreAggregations:{x:{}}` → built;
  `{}`/absent → from-source; partition-not-built throw → unbuilt; other throw → error.
- `server/test/preagg-runs-routes.test.ts` — `/current` summary carries fromSource.
- `src/pages/Admin/hub/__tests__/preagg-readiness-matrix.test.tsx` — renders from-source chip + legend.

## Success

- A passthrough cube shows amber `from source`, not green. A genuinely rollup-served cube stays green.
- `built + fromSource + unbuilt + errored === totalRollups`.
