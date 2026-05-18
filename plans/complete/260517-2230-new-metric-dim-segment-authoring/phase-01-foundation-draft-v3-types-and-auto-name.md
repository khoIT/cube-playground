---
phase: 1
title: "Foundation draft V3 types and auto-name"
status: completed
priority: P0
effort: "0.75d"
dependencies: []
---

## Spike result

Pre-flight Cube API spike (segment-load shape) **NOT RUN** in this implementation
pass — requires a live Cube server. Decision deferred to P7; P7 ships SQL-only
fallback by default, upgrades to cohort-tile when the spike is exercised.

# Phase 1: Foundation draft V3 types and auto-name

## Overview

Pre-flight spike + extend the wizard's draft model with an `artifactKind` discriminator + kind-specific sub-state (`dimKind`, `dimBuilder`, segment reuses existing `filterTree`) + V2→V3 localStorage migration + auto-name builder per kind with collision-suffix. Pure module work — no UI yet.

**Red-team applied:** F-2, F-6, F-10, F-12, F-14, F-15.

## Pre-flight spike (Task 0 — gate)

**Why first:** P5/P6/P7 UX design depends on whether segment cohort-tile is available.

Run a one-off script (or scratch test) in this codebase against a real Cube instance:

```ts
const result = await cubejsApi.load({
  measures: ['mf_users.user_count_approx'],
  segments: ['mf_users.whales'],
});
console.log(result.rawData());
```

Document the outcome in `## Spike result` pinned to this phase file:
- **Pass** → P7 ships segment cohort-tile.
- **Fail / shape mismatch** → P7 ships SQL-only fallback; record failure mode + Cube SDK version.

Same task also verifies modelDir mount: `ls $MODEL_DIR/cubes/mf_users.yml` returns the real catalogue file (sibling repo at `C:\Users\...\code\metrics-catalogue\cube\model\cubes\mf_users.yml`).

## Requirements

- **Functional:** Single polymorphic draft `NewMetricDraftV3`. Discriminator `artifactKind: 'measure' | 'dimension' | 'segment'` drives sub-state visibility. Reducer clears kind-specific sub-state on `artifactKind` change. Auto-name builder picks the right naming rule per kind.
- **Non-functional:** Measure-mode draft shape backward-compatible (existing `useNewMetricDraft` consumers untouched). No behavioral change visible in the UI until P4 wires Step 0.

## Architecture

```
types.ts
├── NewMetricDraftV3 (new, extends V2 with discriminator)
├── ArtifactKind = 'measure' | 'dimension' | 'segment'
├── DimKind = 'banding' | 'time-since' | 'passthrough' | 'boolean'
└── DimBuilder discriminated union (4 sub-types)

hooks/use-new-metric-draft.ts
└── reducer.setArtifactKind() — clears kind-specific sub-state, confirm dialog hook

full-page/hooks/compute-auto-metric-name.ts
└── computeAutoMetricName(draft) — dispatches on artifactKind
    ├── measure: existing op+column logic
    ├── dimension: dim-kind-specific (banding/time-since/passthrough/boolean)
    └── segment: filter-tree slug
```

## Related Code Files

- Modify: `src/QueryBuilderV2/NewMetric/types.ts` — add `ArtifactKind`, `DimKind`, `DimBuilder`, `NewMetricDraftV3`.
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` — extend reducer with `setArtifactKind`, default `artifactKind: 'measure'`, sub-state reset.
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/compute-auto-metric-name.ts` — dispatch per kind.
- Create: `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-draft-v3.test.ts` (NEW)
- Create: `src/QueryBuilderV2/NewMetric/full-page/hooks/__tests__/compute-auto-metric-name-v3.test.ts` (NEW)
- Read for context: existing `__tests__/use-new-metric-draft-v2.test.ts`, `use-new-metric-draft.test.ts`.

## Implementation Steps (TDD — tests first)

1. **Write failing tests for draft reducer kind-switch (corrected per red-team F-10):**
   - `setArtifactKind('dimension')` from default `'measure'` clears `operation`, `inputs`.
   - `setArtifactKind('segment')` clears `operation`, `inputs`, `dimKind`, `dimBuilder`.
   - `setArtifactKind('measure')` clears `dimKind`, `dimBuilder` AND **clears `filterTree`** if previous kind was `segment` (prevents silent cohort→measure-filter conversion). If previous kind was `dimension` (which doesn't use filterTree), `filterTree` survives.
   - `setArtifactKind` away from `segment` with non-empty `filterTree` → reducer surfaces a "needsConfirm" signal that the UI (P4 Step 0 confirm dialog) consumes; reducer itself stays pure (test asserts signal, not dialog).
   - Switching back-and-forth retains shared identity (name, title, sourceCubes).
1a. **Write failing test for V2→V3 migration (red-team F-6):**
   - Seed localStorage with a V2-shaped draft (no `artifactKind` key). Mount `useNewMetricDraft`. Assert `draft.artifactKind === 'measure'`.
   - Assert no V2 fields lost. Assert no extra `dimKind`/`dimBuilder` keys present (only added on dim switch).
2. **Write failing tests for auto-name per kind:**
   - measure: `sum` + `ltv_vnd` → `sum_ltv_vnd` (regression check — unchanged).
   - dimension/banding: column `ingame_total_recharge_value_vnd` → `recharge_value_vnd_tier` (trim numeric column, append `_tier`).
   - dimension/time-since (unit=day, col=`install_date`) → `days_since_install`.
   - dimension/passthrough: column → just the column shortname.
   - dimension/boolean: predicate slug → `is_<slug>` (truncate to ≤32 chars).
   - segment: predicate `country='VN' AND ltv_vnd >= 10000000` → `vn_whales` (token concat, ≤24 chars).
3. **Implement types** in `types.ts`:
   - Add `ArtifactKind`, `DimKind`, `DimBuilder` types.
   - `NewMetricDraftV3 = NewMetricDraftV2 & { artifactKind: ArtifactKind; dimKind?: DimKind; dimBuilder?: DimBuilder }`.
4. **Implement reducer** updates: `setArtifactKind(kind)` action with state-clear logic (per #1 above — `filterTree` clears on segment→other switch). Default `artifactKind: 'measure'` for back-compat (existing draft tests stay green).
4a. **Implement V2→V3 migration (red-team F-6):** in `use-new-metric-draft.ts`:
   - Bump `STORAGE_VERSION` from 2 to 3.
   - Add `migrateLegacyShape(persisted): NewMetricDraftV3` — reads `STORAGE_VERSION` from the persisted blob; if `2`, returns `{...persisted, artifactKind: 'measure'}`; if `3`, returns as-is; if older or missing, falls through to `makeInitialDraft()`.
   - Wire migration into the hydrate effect; assert via test (#1a).
5. **Implement auto-name** dispatcher in `compute-auto-metric-name.ts`. Extract measure logic to private `computeMeasureName`, add `computeDimensionName(draft)`, `computeSegmentName(draft)`. Public `computeAutoMetricName(draft)` dispatches on `draft.artifactKind`.
5a. **Implement auto-name collision suffix (red-team F-15):** `computeAutoMetricName(draft, existingNames)` accepts the set of existing entry names (from `useNewMetricMeta`'s `/meta`). If the computed name already exists in the target cube (any kind), append `_2`, `_3`, … until unique. Surface a yellow note in identity step "name `is_x_y_z` already exists — using `is_x_y_z_2`" (cosmetic; the note implementation lands in P5/P6 identity step, contract here is just the suffix logic).
6. **Run full test suite** — `use-new-metric-draft.test.ts`, `use-new-metric-draft-v2.test.ts` must stay green (no regression).

## Success Criteria

- [ ] **Pre-flight spike result documented** in this file's `## Spike result` section (Task 0).
- [ ] All new tests in `use-new-metric-draft-v3.test.ts` green.
- [ ] All new tests in `compute-auto-metric-name-v3.test.ts` green.
- [ ] V2→V3 migration test green (persisted V2 draft hydrates with `artifactKind: 'measure'`).
- [ ] Existing v1 + v2 draft tests still green (regression gate).
- [ ] `NewMetricDraftV3` exported from `types.ts` with full type narrowing on `artifactKind`.
- [ ] `useNewMetricDraft` accepts undefined `artifactKind` and defaults to `'measure'`.
- [ ] Auto-name returns deterministic stable strings (idempotent — same input → same name).
- [ ] Auto-name collision-suffix appends `_N` when name exists in target cube `/meta` (any kind).
- [ ] `filterTree` cleared on `artifactKind` change FROM `'segment'` (prevents cohort→filter silent conversion).
- [ ] No UI changes visible yet (P1 is pure foundation).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Breaking the existing v1/v2 draft API surface | Make `artifactKind` optional with default `'measure'`; all v1/v2 callers stay typed-correctly via type widening. |
| Slug rules for boolean/segment auto-name produce collisions (`is_foo` vs `is_foo_2`) | Auto-name is non-authoritative — the user can edit it; collision detection is the backend splicer's job (P3). Add a TODO if collision feedback is needed in P8. |
| `setArtifactKind` confirm-dialog logic leaks into reducer (impure) | Keep reducer pure — confirm dialog lives in the future Step 0 component (P4). Reducer just clears state when called. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `setArtifactKind clears measure sub-state on dim/segment switch` | Reducer purity + sub-state isolation |
| `setArtifactKind preserves shared identity fields` | Source / name / tags survive kind switch |
| `computeAutoMetricName dispatches by artifactKind` | Auto-name correctness per kind |
| `measure auto-name unchanged from V2` | Regression gate for existing measure flow |
| `segment slug stable + ≤24 chars` | Predictable segment naming |
