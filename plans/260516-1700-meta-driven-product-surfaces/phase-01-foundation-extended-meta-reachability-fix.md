---
phase: 1
title: "Foundation: extended /meta + reachability fix"
status: pending
priority: P0
effort: "0.5d"
dependencies: []
---

# Phase 1: Foundation — extended /meta + reachability fix

## Context Links

- Cancelled-plan brainstorm: [`../reports/metadata-catalog-tab-system-meta.md`](../reports/metadata-catalog-tab-system-meta.md)
- Wizard reachability hook: `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts`
- Existing meta loader: `src/QueryBuilderV2/hooks/query-builder.ts:322`
- AppContext (token source): `src/components/AppContext.tsx`
- Live probe verification (this plan): `/cubejs-api/v1/meta?extended=true` exposes `joins[]` and `connectedComponent`; plain `/meta` strips both.

## Overview

Replace the SDK `cubeApi.meta()` call with a raw fetch against `/cubejs-api/v1/meta?extended=true`. The SDK has no `extended` knob, and without it `cube.joins[]` is stripped from the payload — silently breaking the wizard's `useReachableMembers` cross-cube graph. This phase unblocks every downstream surface.

## Priority

P0 — gates P2, P3, P4. Cosmetic surfaces depend on data the SDK loader doesn't fetch.

## Key Insights

- `useReachableMembers` already casts `cube as CubeWithJoins` (lines 7-8 in `use-reachable-members.ts`) because the SDK type omits `joins`. The cast is correct; the data isn't arriving — fix is at the loader, not the consumer.
- Live probe (2026-05-16): `/cubejs-api/v1/meta` returns `joins: NO_KEY` for all 11 cubes/views; `?extended=true` returns full `joins: [{ name, relationship, sql }, …]` for the 4 cubes and empty `[]` for the 7 views. `connectedComponent` exposed in both modes.
- The wizard's `joinedCubeCount` display (`SourceSection.tsx:50`) is currently always `0` for users — fix is invisible until this phase lands.
- Auth: reuse `cubejsToken` from `AppContext`. No new env vars. No new auth flow.

## Requirements

### Functional
- `loadMeta()` fetches `/cubejs-api/v1/meta?extended=true` with `Authorization: Bearer <cubejsToken>`.
- Returned payload feeds the existing `cubes` state with `joins` and `connectedComponent` keys preserved.
- `useReachableMembers` produces non-empty graph for source cubes in the joined cluster (verify: `mf_users` shows 3 neighbours).
- `SourceSection` "N joined cubes" text reflects real cluster size.

### Non-functional
- Single fetch on app boot (already the pattern; just changes the URL).
- Existing meta error states (`metaError`, `richMetaError`) continue to work.
- No regression on schema visibility filtering (the existing `displayPrivateItems` flag).

## Architecture

```
Browser
  ├─ AppContext.cubejsToken (already populated by playground init)
  ├─ loadMeta() in QueryBuilderV2/hooks/query-builder.ts
  │   └─ fetch('/cubejs-api/v1/meta?extended=true', { Authorization: Bearer <token> })
  └─ setCubes(payload.cubes) — now includes joins[] + connectedComponent
       ↓
     useReachableMembers   ─▶ wizard
     SidePanelCubeItem     ─▶ cluster badge (P3)
     CatalogPage           ─▶ /catalog grouping (P4)
```

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/hooks/query-builder.ts:322-392` — replace `cubeApi.meta()` with raw fetch + same downstream shape
  - `src/QueryBuilderV2/types.ts` — augment `Cube` type with `joins?: CubeJoin[]` + `connectedComponent?: number`
  - `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts:7-8` — drop local cast, use augmented type
- **Read for context:**
  - `src/components/AppContext.tsx` (token availability)
  - `src/QueryBuilderV2/NewMetric/sections/source-section.tsx` (consumer of `joinedCubeCount`)

## Implementation Steps

1. Add type `CubeJoin = { name: string; relationship: 'belongsTo' | 'hasOne' | 'hasMany'; sql: string }` to `src/QueryBuilderV2/types.ts`. Augment the local `Cube` type alias to include `joins?: CubeJoin[]` and `connectedComponent?: number`.
2. In `query-builder.ts`, replace the `cubeApi.meta().then(...)` block with a raw `fetch` against `${apiUrl}/meta?extended=true` carrying `Authorization: Bearer <token>`. **Auth plumbing (Validation Session 1):** source `apiUrl` and `token` via `useContext(AppContext)` directly inside `useQueryBuilder` — both fields are already exposed on `ContextProps` (`src/components/AppContext.tsx:36-39`). No new props on the hook; no prop drilling. The SDK `cubeApi` factory construction at `src/hooks/cubejs-api.ts:10` reads the same two values, so context is the authoritative source. Preserve the existing `currentRequest` guard, `setIsMetaLoading`, error mapping, and the `visibilityFilter` semantics.

   <!-- Updated: Validation Session 1 - useContext(AppContext) is the chosen mechanic for apiUrl+token, not new hook props or cubeApi.transport reach-in -->

   **Note on `connectedComponent`:** Verification surfaced `cube.connectedComponent` is ALREADY exposed on standard `/meta` (used at `query-builder.ts:1106` for `joinableCubes` with a `@ts-ignore` cast). Only `joins[]` requires `extended=true`. P3 cluster badges and P4 catalog grouping could in principle run without P1 — but P1 still gates wizard cross-cube reachability via `cube.joins[]` SQL refs. Keep P1 as the gate.
3. Map the raw payload to the existing `newMeta` shape so downstream code (`memberData`, `setMembers`, `setCubes`) is unchanged. Keep `setMeta(newMeta)` calls — only the *upstream* fetch changes.
4. Remove the runtime cast in `use-reachable-members.ts` (lines 7-8) now that the `Cube` type carries `joins`. The hook body needs no changes — it already iterates `cube.joins[]` correctly.
5. Smoke test: open Playground, select `mf_users` in QueryBuilder, open wizard, pick `mf_users` as source. Verify "3 joined cubes" text appears in SourceSection. Pick `active_daily` as source. Verify "1 joined cube" appears.
6. Verify the schema-write-handler's `waitForMember` poll still works after a wizard save — it polls `/meta`, may need `extended=true` too if it checks joins.

## Todo List

- [ ] Add `CubeJoin` type + augment `Cube` in `src/QueryBuilderV2/types.ts`
- [ ] Rewrite `loadMeta()` body to raw fetch with `extended=true`
- [ ] Drop runtime cast in `use-reachable-members.ts`
- [ ] Re-verify `vite-plugins/meta-poll.ts` works with the new fetch URL
- [ ] Manual smoke: wizard source picker shows non-zero joined-cube count
- [ ] Visual regression check: sidebar still renders unchanged (no UI changes this phase)

## Success Criteria

- [ ] `/cubejs-api/v1/meta?extended=true` is the only meta endpoint the playground hits at boot
- [ ] `useReachableMembers('mf_users').joinedCubeCount === 3`
- [ ] `useReachableMembers('active_daily').joinedCubeCount === 1`
- [ ] Existing QueryBuilder behavior (member list, search, query exec) unchanged
- [ ] Wizard save → meta refetch still picks up the new measure (waitForMember still works)

## Risk Assessment

- **Risk:** Cube version doesn't honor `?extended=true`. Mitigation: probe at step 0; if unsupported, document the Cube version requirement in README and fail loudly at startup.
- **Risk:** `extended=true` payload meaningfully larger → slower boot. Mitigation: schema is small (11 cubes); measured payload ~50KB. Non-issue at current scale.
- **Risk:** Existing consumers depend on the SDK's typed return shape. Mitigation: map raw response to the same `newMeta` interface; existing downstream code is untouched.

## Security Considerations

- Same auth posture as today (JWT from `AppContext.cubejsToken`). No new surface.
- `joins[].sql` from extended payload is *the join condition*, not member data — exposing it doesn't leak anything not already implicit in queries the user can run.
