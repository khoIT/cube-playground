---
phase: 4
title: "YAML Generator + Validate/Save"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1, 2, 3]
---

# Phase 4: YAML Generator + Validate/Save

## Context Links

- Brainstorm: [`plans/reports/brainstorm-260516-1526-define-metric-wizard.md`](../reports/brainstorm-260516-1526-define-metric-wizard.md) §YAML generation rules, §Acceptance criteria 6-9.
- Phase 1 endpoint contract: `POST /api/playground/schema/write` (request + response shapes).
- Phase 3 reachable-members hook (cube/member metadata + join info for cross-cube refs).

## Overview

Wire the wizard end-to-end: live YAML preview, **Validate** that dry-runs the new measure via `POST /cubejs-api/v1/sql`, and **Define** that POSTs to the dev write endpoint and reflects the result back into the app via a `/meta` refetch + toast.

## Key Insights

- YAML generation is pure (`draft → string`); easy to test independently of React.
- Cross-cube `sql:` references rely on Cube resolving the join via its existing `joins[]` — we only emit `"{<remoteCube>}.<col>"`.
- Snake_case vs camelCase: infer naming convention from peers on the source cube (look at the longest run of existing measure names); fall back to snake_case.

## Requirements

**Functional**
- `use-metric-yaml(draft, reachable)` returns `{ yaml: string, error: string | null }` recomputed on every change.
- `YamlPreview` renders YAML via `PrismCode` with `language="yaml"`.
- **Validate** button: builds a synthetic Cube query that selects the new measure (`<sourceCube>.<measureName>` + an arbitrary same-cube grouping dimension if available), POSTs to `/cubejs-api/v1/sql` with `Authorization: Bearer <jwt>`. Shows the compiled SQL or the compile error inline in `DryRunSqlPreview`.
- **Validate** is required before **Define** only if validation has not succeeded; clicking Define performs an implicit Validate check using the most recent draft hash (if stale, runs Validate first).
- **Define** button: disabled while invalid or while a previous save is in flight; calls `POST /api/playground/schema/write` with `{ cubeName, measureName, yamlPatch }`.
- On `200`, the app:
  - Refetches `/meta` (invalidate the existing meta cache used by the QueryBuilder).
  - Shows a success toast: `<measure_name> added to <cube_name>` (uses the kit's notification API already used elsewhere).
  - Closes the dialog and resets draft.
- On `409` (mtime conflict), shows the "Cube file changed externally — reopen the wizard" toast and keeps the dialog open with state intact.
- On `504` (hot-reload timeout), shows the rollback toast with the error from the server payload and keeps the dialog open.

**Non-functional**
- YAML generator: pure function module, no React imports.
- Toast/notification component pulled from whichever lib the app already uses.

## Architecture

```
draft ─▶ use-metric-yaml ─▶ YamlPreview
                          \
                           └─▶ buildSyntheticQuery ─▶ /cubejs-api/v1/sql ─▶ DryRunSqlPreview
                                                                       │
                                                          Validate ────┤
                                                          Define ──────┴──▶ /api/playground/schema/write
                                                                                  │
                                                                                  └─▶ refetch /meta + toast
```

## Related Code Files

**Create**
- `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` — pure `generate(draft, ctx): { yaml, fragment }` where `fragment` is the parseable mapping the backend will splice.
- `src/QueryBuilderV2/NewMetric/yaml/infer-naming-convention.ts` — `inferConvention(peers: string[]): 'snake' | 'camel'`.
- `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml.test.ts`
- `src/QueryBuilderV2/NewMetric/hooks/use-metric-yaml.ts` — wraps the generator + memoization.
- `src/QueryBuilderV2/NewMetric/hooks/use-dry-run-sql.ts` — wraps the `/sql` call with a draft-hash cache.
- `src/QueryBuilderV2/NewMetric/api.ts` — `postSchemaWrite({ cubeName, measureName, yamlPatch })`.

**Modify**
- `src/QueryBuilderV2/NewMetric/preview/yaml-preview.tsx` — render `yaml` from the hook.
- `src/QueryBuilderV2/NewMetric/preview/dry-run-sql-preview.tsx` — render SQL or error.
- `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` — wire footer buttons; call `appContext.refreshMeta()` on Save success. (`AppContext.refreshMeta` lands in Phase 2.)

## Implementation Steps

1. `generate-measure-yaml.ts`:
   - Inputs: `draft`, `ctx = { sourceCube, reachableMembers, peerMeasureNames }`.
   - Decide name casing via `inferConvention(peerMeasureNames)`; transform `draft.name` if mismatched.
   - Emit a mapping with keys in stable order: `name`, `type` (mapped from `operation`; `countDistinct → count_distinct` per Cube YAML spec), `sql`, `title?`, `description?`, `format?`, `filters?`.
   - For `ratio`: emit standard Cube `type: number` with `sql: "{measure_a} / NULLIF({measure_b}, 0)"` referencing two same-cube measures (cross-cube ratio is Phase 2 per brainstorm).
   - For cross-cube `Of`: `sql` becomes `"{<remoteCube>}.<col>"`.
   - For same-cube `Of`: `sql` becomes `"{<sourceCube>}.<col>"`.
   - Return `{ yaml: string, fragment: string }` where `fragment` is just the mapping (no leading `- ` or `measures:` key) — the backend splice owns that.
2. `infer-naming-convention.ts`:
   - If majority of peer names match `/^[a-z][a-z0-9_]*$/` → `snake`.
   - If majority match `/^[a-z][a-zA-Z0-9]*$/` and contain at least one uppercase → `camel`.
   - Tie / empty → `snake`.
3. `use-metric-yaml.ts`:
   - `useMemo` on `(draft, ctx)`; returns `{ yaml, fragment, error }`.
4. `use-dry-run-sql.ts`:
   - Compute a stable hash of the relevant draft fields.
   - When `validate()` is called: build synthetic query `{ measures: ['<sourceCube>.<measureName>'], limit: 1 }`; if a same-cube dimension exists, add it to `dimensions` for a more representative compile.
   - Cache `{ sql, error }` per hash; expose `isStale`, `result`, `run()`.
5. `api.ts`:
   - `postSchemaWrite` posts JSON, handles `200/409/504/other` distinctly; returns a discriminated union.
6. Wire footer:
   - `Validate` calls `dryRun.run()`; the SQL pane updates.
   - `Define` checks `validation.isValid && !dryRun.error`; if `dryRun.isStale`, runs Validate first; on Validate success, calls `postSchemaWrite`.
   - Success: trigger meta refetch + toast + dialog close + reset.
   - 409: toast + keep state.
   - 504: toast with rollback note + keep state.
7. Tests:
   - `generate-measure-yaml.test.ts`: sum (same-cube), countDistinct (cross-cube via join), ratio (same-cube), with/without filter, with peer-derived camelCase, fallback snake_case.
   - `infer-naming-convention.test.ts`: empty, mixed, all-snake, all-camel, leading-underscore edge.
8. Manual smoke: create a `countDistinct` measure on a dev cube; confirm sidebar shows it within ~1s; refresh; query it.
9. Update top-level docs cross-reference in `docs/codebase-summary.md` (if it lists query builder modules) — out of scope if it doesn't.
10. `npm run typecheck` + `npm run test`.

## Todo List

- [ ] `generate-measure-yaml.ts` + tests
- [ ] `infer-naming-convention.ts` + tests
- [ ] `use-metric-yaml` hook
- [ ] `use-dry-run-sql` hook (stale-hash cache — Validation Session 1 decision 4)
- [ ] `api.ts` with discriminated response
- [ ] Footer button wiring (Validate / Define)
- [ ] Toast + `appContext.refreshMeta()` on success
- [ ] Manual smoke against a dev cube
- [ ] `npm run typecheck` + `npm run test` pass

<!-- Updated: Validation Session 1 - meta refetch via AppContext.refreshMeta (lifted in Phase 2) -->


## Success Criteria

- [ ] Brainstorm acceptance criterion 6 (live YAML preview, regenerates on every change).
- [ ] Brainstorm acceptance criterion 7 (Validate hits `/sql`, surfaces compile errors inline).
- [ ] Brainstorm acceptance criterion 8 (Save posts to the dev endpoint, returns 200 only when `/meta` confirms).
- [ ] Brainstorm acceptance criterion 9 (success toast + dialog close + meta refetch).
- [ ] Success metric: < 30s for a single-cube `countDistinct` (manual stopwatch).
- [ ] 20 successive saves on a clean repo: zero broken YAML files (test harness or scripted manual).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| YAML generator emits keys in unstable order | Stable key order enforced by an array of `[key, value]` tuples before `yaml.dump`. |
| `inferConvention` mis-detects when peers are mixed | Tie-break to `snake`; the chosen name is visible in the YAML preview before save. |
| Validate request lacks auth and returns 403 | Reuse the existing JWT from `PlaygroundContext` (same path other QB calls use). |
| Define succeeds locally but `/meta` cache stays stale | Refetch meta after every successful save; meta cache key already invalidates on token change — extend to also invalidate on save. |
| ratio operand validation gap | Phase 2 in brainstorm; v1 requires both operands same-cube — enforced in `validate()`. |

## Security Considerations

- Validate and Define both call dev endpoints; production builds never reach the write path.
- YAML preview is rendered as text (no HTML).
- Toast text uses string interpolation of names that have already passed `^[A-Za-z_][A-Za-z0-9_]*$` validation, so they are safe to render.

## Next Steps

- After v1 ships: separate "Define join" flow (Phase 2 follow-up); editing/deleting existing measures; cross-cube ratio; prod write path with auth + PR workflow.
