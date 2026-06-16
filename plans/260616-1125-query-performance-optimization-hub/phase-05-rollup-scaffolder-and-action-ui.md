# Phase 05 — Rollup-YAML scaffolder + admin action UI

## Context
- Pure-scaffolder precedent: `server/src/services/metric-stub-scaffolder.ts:70-96` (pure, no I/O, Zod-valid output, slug/collision helpers). MIRROR this shape.
- Rollup authoring rules (lessons-learned.md:57-73 + memory "Cube rollup authoring rules"): time_dimension MUST match the query's bound time dim; additive measures only (count/sum/min/max/count_distinct_approx); dteventtime vs log_date — for a tz timestamp time-dim add `build_range_end: SELECT LEAST(MAX(<ts>), current_timestamp)`; granularity `day`, `partition_granularity: month`.
- Registry for existing rollups + measure types: `preagg-model-registry.ts:40-127`.
- Action affordance slot was stubbed in P2 (`query-perf-row.tsx`).

**Priority:** P3. **Status:** pending. **Depends on:** P3 (matchability/measures) + P4 (best playbook = scaffolds:'rollup').

## Scaffolder — `server/src/services/rollup-yaml-scaffolder.ts` (pure)
`scaffoldRollupDraft(shape, opts): { yaml: string; warnings: string[] }`:
- Input: P1 `query_shape` (cubes/measures/dimensions) + the query's bound time dimension (NOTE: P1's `projectQueryShape` keeps time-dim NAME in `dimensions` — see activity-store.ts:97-103; the scaffolder must identify which dimension is the time dim, via registry `type:time` lookup).
- Output: a draft `pre_aggregations` YAML block for ONE cube (the dominant cube of the shape):
  ```yaml
  pre_aggregations:
    <name>_batch:
      measures: [<additive measures only>]
      dimensions: [<non-identity grouping dims>]
      time_dimension: <the query's bound time dim>   # MUST match query
      granularity: day
      partition_granularity: month
      # build_range_end cap emitted ONLY when time_dimension is a tz timestamp (dteventtime-like)
      build_range_end:
        sql: SELECT LEAST(MAX(<ts_col>), current_timestamp) FROM <source>
  ```
- **Rules enforced in code (pure):**
  - Drop non-additive measures (avg / exact count_distinct) from the draft; emit a `warning` listing them ("non-additive — remodel as sum+count or count_distinct_approx before rolling up").
  - Drop identity dimensions (P3 `IDENTITY_DIMENSIONS`) — emit warning ("per-user dimension excluded; if the query needs per-user rows, a rollup cannot serve it — see materialize-snapshot playbook").
  - If `matchability=unmatchable` → return NO yaml, `warnings:['This query cannot be served by a rollup (per-user row listing).']`. The scaffolder refuses rather than emit a useless rollup. (UI should only call it for `scaffolds:'rollup'` matches, but defend anyway.)
  - time_dimension is a tz timestamp (member resolves to a timestamp col, not DATE) → include the `build_range_end` LEAST cap; else omit.
  - Name: `<cube-without-prefix>_batch`; if a same-named rollup exists in registry, suffix `_v2` (collision helper like metric-stub-scaffolder.ts:74-79).
- DRAFT only — header comment in the emitted YAML: "# DRAFT — review against live /meta; verify routing via compiled SQL (/cube-api/v1/sql), not usedPreAggregations". Per the code-comments rule: NO plan/phase references in the emitted YAML.
- Pure — no file write, no Cube call. Returns a string for the admin to copy. (No auto-apply / no PR — locked decision 2.)

## Build-cost note (optional, deferred)
`cube-dev/scripts/measure-preagg-build.mjs` can estimate build cost of the drafted rollup — surface as a "measure build cost" link, NOT auto-run (it's an upstream operation). Deferred to a follow-up; the action UI just shows the YAML + warnings in v1.

## Read API
- Extend `query-perf.ts`: `GET /api/query-perf/:id/scaffold` — loads row → P3 verdict → if `scaffolds:'rollup'` applies, return `scaffoldRollupDraft(...)`. On-demand only.

## Action UI
- `query-perf-row.tsx` action affordance ("Optimize →") opens a panel/drawer `query-perf-optimize-panel.tsx`:
  - Header: the query shape (member chips) + verdict reason.
  - **Suggestion** section: best playbook (title, rationale, steps) + alternatives (from P4 `/:id/suggestion`).
  - **Draft rollup** section (only when best playbook `scaffolds:'rollup'`): the scaffolded YAML in a copy-able code block (`--surface-inverse` code surface token) + warnings list (`--warning-soft/-ink`) + "Copy YAML" button.
  - **LLM** affordance: rendered only when `needsLlm` (wired in P6) — shows "Generate suggestion" button; disabled/"Soon" until P6 ships.
- Design: drawer/panel via existing patterns; tokens only; code block uses `--surface-inverse`/`--text-inverse` (design-guidelines §11 component primitives). No inline hex.

## Related files
- Create: `server/src/services/rollup-yaml-scaffolder.ts`, `rollup-yaml-scaffolder.test.ts`, `src/pages/Admin/hub/query-perf-optimize-panel.tsx`.
- Modify: `server/src/routes/query-perf.ts` (`/:id/scaffold`), `query-perf-row.tsx` (wire action), `query-perf-data.ts` (suggestion/scaffold fetch hooks).

## Todo
- [ ] rollup-yaml-scaffolder.ts (pure; additive filter, identity drop, time-dim resolve, ts-cap, collision suffix, unmatchable refusal, draft header)
- [ ] /:id/scaffold route
- [ ] query-perf-optimize-panel.tsx (suggestion + draft YAML + copy + warnings)
- [ ] wire action affordance + data hooks
- [ ] unit tests: additive→clean yaml; mixed→drops non-additive w/ warning; dteventtime→build_range_end cap; log_date→no cap; unmatchable→no yaml+warning; name collision→_v2

## Success criteria
- A matchable additive query → valid, copy-pasteable `pre_aggregations` block whose `time_dimension` equals the query's bound time dim (the cfm dteventtime/log_date trap is honored — tested both ways).
- Non-additive measures excluded with a clear warning; per-user dims excluded.
- Unmatchable query → scaffolder returns no YAML + explanatory warning (no useless rollup emitted).
- Emitted YAML contains NO plan/phase references (code-comments rule).
- Scaffolder pure (tested with fixtures + registry excerpt); no file/Cube I/O.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Scaffolds a rollup that won't seal (dteventtime no cap) | M×H | ts-timestamp detection → emit LEAST(...,current_timestamp) cap (lessons-learned.md:63-67); tested. |
| Time-dim mismatch in draft → silent fallthrough persists | M×H | time_dimension copied from query's bound dim, not guessed; warning if registry's rollup differs. |
| Admin copies draft without review | L×M | DRAFT header + "verify via compiled SQL" note + warnings; no auto-apply (locked). Human-in-loop by design. |
| Identifying "the time dim" from shape ambiguous | M×M | Resolve via registry `type:time` lookup, not positional; if none found, warn "no time dimension — rollup needs one". |

## Security
Admin-gated routes (inherit preHandlers). Scaffolder consumes NAMES-only shape — no PII. Output is text, never executed/written server-side.

## Open questions
1. Surface the `measure-preagg-build.mjs` build-cost estimate inline, or keep deferred? (Plan: deferred — it's an upstream op; v1 shows YAML only.)
