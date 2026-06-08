# 2026-06-09 — VIP Care Playbook Console: display id ≠ mutation key trap

## Context

**Plan:** `plans/260608-2152-vip-care-playbook-console/` — CS console for cfm_vn/jus_vn with monitor + ledger + member360 + playbook builder. Branch: `feat/vip-care-playbook-console`.

**Session scope:** Ship Playbook Builder (seed + override + custom playbooks, CRUD grid, threshold cohort w/ supplemental predicate). Code review flagged **HIGH: cloned/custom playbooks 404 on edit**. Root-cause analysis revealed a subtle id-identity trap spanning server schema → merge layer → client types → route dispatch.

## The bug (surface symptom)

User selects a custom or override playbook in the grid and clicks Edit. Form loads seed data fine, but PATCH/DELETE route returns 404. Seed playbooks Edit fine. Only cloned/custom broken.

## Root cause: 3-tier source union + display id reuse

### Schema layer
Three playbook sources: `seed` (immutable shipped defaults), `override` (patch a seed), `custom` (new playbook from scratch). Server persists:
- **seed:** no override row; user sees seed base as-is.
- **override:** creates `playbook_overrides` row with uuid `id`; patches the seed.
- **custom:** creates `playbook_overrides` row with uuid `id`; all fields customized.

### Merge & resolution layer
`ResolvedPlaybook` type (server-side resolver + client mirror) merges seed + override:
```ts
finalize(resolved: ResolvedPlaybook): ResolvedPlaybook {
  resolved.id = this.seedBaseId  // ← REUSE seed base-id as display id
  return resolved
}
```

The intent: stable display id across "seed + patch" pair. **Problem:** the mutation key is **not** the display `id`.
- **Seed playbook:** PATCH/DELETE key = `base_id` (the seed identifier from YAML).
- **Override/custom playbook:** PATCH/DELETE key = `overrideId` (the uuid row in `playbook_overrides`).

Finalize stamps both with `id = base_id`, but override PATCH expects `overrideId`.

### Client type divergence
`ResolvedPlaybook` on the server emits:
```ts
{
  id: "04",               // display (= seed base-id)
  overrideId: "uuid...",  // mutation key for override
  name: "...",
  source: "override"      // ← correctly 3-valued
}
```

Client `ResolvedPlaybook` type had **dropped `overrideId`** during an earlier refactor:
```ts
// ❌ Client type (missing overrideId)
type ResolvedPlaybook = {
  id: string
  name: string
  source: "seed" | "override" | "custom"
  // overrideId: string  ← DROPPED
}
```

### Route dispatch
Grid row click dispatches edit via the display `id`:
```ts
handleEditPlaybook(playbook: ResolvedPlaybook) {
  // Routes PATCH /playbooks/:id
  // But override needs PATCH /playbooks/:id?overrideId=<uuid>
  // Or split: seed → PATCH(id), override → PATCH(overrideId)
}
```

The route handler keyed on `id` alone, which:
- ✅ Seed `id="04"` → finds seed in YAML.
- ❌ Override `id="04"` → searches `playbook_overrides.id="04"` (looking for uuid using the display id) → 404.

### Compounding misjudgment
Code review flagged "custom playbooks broken," which was half-true. A grep showed the **override playbooks were also broken** (same mutation-key mismatch), but only under-identified in the trace.

## What we tried

1. **First hypothesis:** Client isn't sending `overrideId` → added logging, confirmed it's dropped from the type.
2. **Second hypothesis:** Route handler ignores query param → confirmed; keyed on path `:id` alone.
3. **Third fix attempt:** Add `overrideId` to route query + pass it from the grid. **Incomplete** — didn't address the deeper issue that `id` has two different meanings.

## Lesson: display id ≠ mutation key

When a merge/resolution layer reuses a stable, human-friendly display `id` across multiple source tiers (seed, override, custom), the **row's mutation key can diverge**. The display id optimizes for UX (one id to show/reference); the mutation key optimizes for data identity (which row to update/delete).

**The fix:**
1. Client `ResolvedPlaybook` type regains `overrideId: string | undefined`.
2. New shared pure helper: `mutationTargetFor(playbook)` → `{ key: 'base_id' | 'overrideId', value: string }`. Encodes server-id semantics:
   - `source === 'seed'` → `{ key: 'base_id', value: playbook.id }` (PATCH /playbooks/:id)
   - `source === 'override' || 'custom'` → `{ key: 'overrideId', value: playbook.overrideId }` (PATCH /playbooks/:overrideId)
3. Grid dispatch calls `mutationTargetFor(playbook)` and routes with the correct key.
4. Regression test locks both override + custom edit paths under "Edit playbook > override + custom variants."

**Verification cadence:** id-identity must be verified end-to-end (UI button → fetch dispatch → route lookup → store query), not just at the route level where a developer test using the raw row id will pass.

## Also shipped

**Migration 039 + schema extension:** Playbook thresholds now accept an optional **supplemental AND/OR predicate** ANDed onto the base cohort predicate. User chose the full contract extension (server + UI) over removing the orphan UI section. Threshold form now validates both base + supplemental; unlocked future "advanced filters" UX without a schema revisit.

## Tests

- **Grid edit + delete:** 2 new tests covering override + custom playbooks (parallel to seed).
- **Mutation dispatch:** `mutationTargetFor` unit test: seed / override / custom paths.
- Manual: created override of seed "04", edited name + threshold, saved, re-loaded grid — id stable, data persisted.

## Impact

**Severity:** HIGH (custom/override playbooks completely unusable for edit/delete). **Blast radius:** 2-value source union + 2-path mutation dispatch was broken for 2/3 sources; code review caught it before merge.

**Future pattern:** When a resolver reuses an id, document or type-enforce which operation uses which identifier. A comment like `// display id: base_id, mutation key: overrideId` in the schema saves the next refactor from rediscovering this.

## Open questions

None — pattern locked and tested. Migration 039 supplemental predicate validated with threshold form.
