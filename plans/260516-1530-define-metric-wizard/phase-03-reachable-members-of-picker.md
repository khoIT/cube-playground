---
phase: 3
title: "Reachable-Members + Of-Picker"
status: completed
priority: P1
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Reachable-Members + Of-Picker

## Context Links

- Brainstorm: [`plans/reports/brainstorm-260516-1526-define-metric-wizard.md`](../reports/brainstorm-260516-1526-define-metric-wizard.md) §Architecture (Source/Of), §Risks (no join path).
- Cube meta shape: `cube.joins[]` exposes `name` (target cube) and `sql` (the join expression) for 1-hop reachability.

## Overview

Replace the Phase 2 Of stub with a hook that builds the list of reachable members from a chosen source cube: same-cube dimensions/measures + 1-hop neighbours via `cube.joins[]` from `/meta`. Out-of-graph members are excluded from the picker (rather than greyed out) so the user can't author an unjoinable measure.

## Key Insights

- Reachability for v1 is undirected 1-hop: if `A.joins[].name === B`, members of `B` are reachable from `A` and vice-versa. No multi-hop. No inference.
- Display format is `users.email (via orders.user_id = users.id)` — humans need to see *which* join brought a member into the list.
- The picker filters out reserved/system members already exposed by the existing meta consumer.

## Requirements

**Functional**
- `use-reachable-members(sourceCube)` returns `{ items: ReachableMember[] }` where each item has `{ cubeName, memberName, kind: 'dimension' | 'measure', viaJoin?: { fromCube: string, sql: string } }`.
- Items from the source cube have `viaJoin === undefined`.
- Items from joined cubes carry the join SQL string verbatim for display.
- If a member's cube is not reachable from `sourceCube`, it is omitted.
- `OfSection` lists reachable members grouped by cube; for ratio, two pickers (`ofMember`, `ofMemberB`) using the same source.
- When the user has picked an `ofMember` whose cube has no path back to `sourceCube` (defensive — shouldn't be reachable through the picker, but guards against URL-restored state), the **Define** button stays disabled with the inline message from the brainstorm.

**Non-functional**
- Pure hook; no fetches — it reads from the already-fetched meta via the existing context.
- Memoized by `(sourceCube, metaRev)`.

## Architecture

```
meta (cubes[]) ──▶ buildJoinGraph(meta) ──▶ JoinGraph (Map<cube, Set<cube>>)
                                       └─▶ joinSqlByPair (Map<"a|b", string>)

useReachableMembers(sourceCube)
  ├─ JoinGraph.get(sourceCube) ∪ {sourceCube}
  ├─ for each reachable cube: emit members tagged with viaJoin
  └─ memoized
```

## Related Code Files

**Create**
- `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts` — the hook (and its pure `buildJoinGraph` helper, exported for tests).
- `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-reachable-members.test.ts` — graph + member listing tests.

**Modify**
- `src/QueryBuilderV2/NewMetric/sections/of-section.tsx` — replace stub with real list; show `(via …)` suffix.
- `src/QueryBuilderV2/NewMetric/sections/source-section.tsx` — surface reachable cube count next to source label ("3 joined cubes"). Informational only.
- `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` — add validation rule: if `ofMember`/`ofMemberB` does not appear in the reachable list for the current `sourceCube`, mark as invalid with the brainstorm copy.

## Implementation Steps

1. Inspect existing meta consumer (likely `QueryBuilderV2/hooks/query-builder.ts` or a context) and confirm how to pull the cubes array.
2. Implement `buildJoinGraph(meta)`:
   - Iterates `cubes[]`, reads `joins[]`, builds an undirected adjacency map.
   - Records the join SQL keyed by `"min(a,b)|max(a,b)"` for stable lookup regardless of direction.
3. Implement `useReachableMembers(sourceCube)`:
   - `useMemo` keyed on `(meta, sourceCube)`.
   - Resolve neighbour cubes; for each cube collect `dimensions` and `measures`; attach `viaJoin` for non-source cubes.
   - Sort: source-cube members first, then by cube name asc, then by member name asc.
4. Update `OfSection`:
   - Use a `Select`/`Listbox` grouped by cube (kit primitive used elsewhere in QB).
   - Render label as `<member.name> (via <viaJoin.sql>)` when applicable.
   - Disabled if `sourceCube === null`.
5. Update `SourceSection` to display `${reachable.length - sameCube.length} joined cubes` as a hint.
6. Extend `validate(draft)` to require `ofMember ∈ reachableNames` (pass `reachableNames` in from the dialog).
7. Tests for `buildJoinGraph` and `useReachableMembers` using a minimal fixture meta with three cubes and one join.
8. `npm run typecheck` + `npm run test`.

## Todo List

- [ ] Build `buildJoinGraph` + tests
- [ ] Build `useReachableMembers` + tests
- [ ] Wire into `OfSection` with grouped list + `(via …)` formatting
- [ ] Hint reachable-cube count in `SourceSection`
- [ ] Extend draft validation to enforce reachability
- [ ] `npm run typecheck` + `npm run test` pass

## Success Criteria

- [ ] Picking a source cube with one join exposes both same-cube and joined-cube members.
- [ ] Picking a source cube with zero joins exposes only same-cube members.
- [ ] `viaJoin.sql` matches the verbatim join expression from `meta`.
- [ ] Out-of-graph members cannot appear in the picker.
- [ ] Draft validation rejects `ofMember` from a cube outside the reachable set.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Cube exposes joins differently across views vs cubes | Use only `cubes[].joins` (skip `views`); document in code comment. |
| Performance with large meta (100+ cubes) | Memoize `buildJoinGraph` at hook level keyed on meta revision; graph build is O(cubes × joins). |
| Self-joins or duplicate join entries | Dedupe by pair key; ignore self-loops. |

## Security Considerations

- No new network calls.
- All join SQL strings are rendered as text (no `dangerouslySetInnerHTML`).

## Next Steps

- Phase 4 emits the YAML using the reachable cube + member metadata and wires Validate/Save.
