---
phase: 3
title: "Cube meta exposure and YAML wiring"
status: complete
priority: P1
effort: "0.15d"
dependencies: [1, 2]
---

<!-- Updated: Validation Session 1 â€” Path A (external YAML edit) dropped; Path B locked. -->

# Phase 3: Cube meta exposure and YAML wiring

## Overview

Wire `cube.meta.game_id` + `cube.meta.cdp_source` end-to-end via a **client-side mapping module** keyed by cube name. External Cube YAML edit was dropped during Validation Session 1 to remove cross-repo coordination + Cube reload. Result: P3 is now a small type-widening + one mapping file + a test.

## Requirements

### Functional

- `CatalogCube` type in `use-catalog-meta.ts` gains optional `meta?: { game_id?: string; cdp_source?: string; [k: string]: unknown }`.
- New module `src/pages/Catalog/cdp-projection/cube-to-cdp-mapping.ts` exports:
  ```ts
  export const CUBE_TO_CDP_MAPPING: Record<string, { game_id: string; cdp_source: string }> = {
    mf_users: { game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' },
  };
  ```
- `useCatalogMeta` merges the mapping onto fetched `cubes[*].meta` after `/meta?extended=true` returns:
  ```ts
  const enriched = cubes.map(c => ({
    ...c,
    meta: { ...(c.meta ?? {}), ...(CUBE_TO_CDP_MAPPING[c.name] ?? {}) },
  }));
  ```
- For cubes not in `CUBE_TO_CDP_MAPPING`, `cube.meta` is unchanged from server response (may still be `undefined`).
- `mf_users` cube â†’ `cube.meta.game_id === 'bal_vn'` && `cube.meta.cdp_source === 'iceberg.ballistar_vn.mf_users'`.

### Non-functional

- `useCatalogMeta` still returns the same shape for consumers other than CDP code â€” no breaking changes.
- Mapping file â‰¤ 30 lines; documented at top as "client-side bridge until cube YAML carries `meta:` natively".
- Merged `meta` precedence: mapping overrides server value if both present (mapping is the canonical CDP-side source this round).

## Architecture

```
src/pages/Catalog/
  use-catalog-meta.ts                       â—„â”€â”€ modify (type widen + merge)
  cdp-projection/
    cube-to-cdp-mapping.ts                  â—„â”€â”€ new (â‰¤ 30 lines)
  __tests__/
    use-catalog-meta.test.ts                â—„â”€â”€ new (FIRST)
```

```
fetch /meta?extended=true â†’ { cubes: [...] }
                              â”‚
                              â–¼
                    mergeCdpMapping(cubes)
                              â”‚
        for each cube:        â–¼
        meta = { ...server.meta, ...CUBE_TO_CDP_MAPPING[cube.name] }
                              â”‚
                              â–¼
                    setCubes(enriched)
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/cdp-projection/cube-to-cdp-mapping.ts`
  - `src/pages/Catalog/__tests__/use-catalog-meta.test.ts`
- **Modify:**
  - `src/pages/Catalog/use-catalog-meta.ts` â€” widen `CatalogCube` type; import + merge mapping after fetch
- **Read (context):**
  - existing `use-catalog-meta.ts` (97 lines today; new code â‰¤ 30 lines added)
- **Delete:** none

## Implementation Steps (TDD)

1. **Test first** â€” `use-catalog-meta.test.ts`:
   - Mock fetch returns extended `/meta` w/ `mf_users` cube without `meta` â†’ after merge, hook returns `cube.meta.game_id === 'bal_vn'` and `cube.meta.cdp_source === 'iceberg.ballistar_vn.mf_users'`
   - Mock fetch returns `active_daily` cube (not in mapping) â†’ `cube.meta` stays whatever server returned (likely `undefined`)
   - Mock fetch returns `mf_users` w/ server-provided `meta: { someExtra: 'value' }` â†’ merged result has all three keys (game_id, cdp_source, someExtra)
2. Run â†’ red.
3. Write `cube-to-cdp-mapping.ts`.
4. Widen `CatalogCube` type in `use-catalog-meta.ts`:
   ```ts
   export type CatalogCube = {
     // â€¦ existing fields
     meta?: { game_id?: string; cdp_source?: string; [k: string]: unknown };
   };
   ```
5. Import `CUBE_TO_CDP_MAPPING` and merge inside the `.then` after parsing the response.
6. Run tests â†’ green.
7. `npm run typecheck` clean.
8. Manual smoke: open `/catalog`, console-log `cubes` array, confirm `mf_users` cube has `meta.cdp_source` set.

## Success Criteria

- [ ] All 3 hook test cases green
- [ ] `CatalogCube` type carries optional `meta` w/ `game_id` + `cdp_source`
- [ ] `mf_users` cube observable client-side w/ both meta fields populated
- [ ] Other cubes' behavior unchanged
- [ ] `cube-to-cdp-mapping.ts` â‰¤ 30 lines, includes only `mf_users`
- [ ] `npm run typecheck` clean
- [ ] No regression in catalog grid rendering

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Mapping file diverges from real CDP source FQN | Header comment: "FQN locked per Validation Session 1. Confirm against real CDP env when proxy lands." |
| Future cubes need entries in the map | Trivial to add; `find-similar` / catalog tooling can read this map for completion later |
| Type widening breaks unrelated callers | Optional field + `Record<string, unknown>` superset â€” no consumer today reads `cube.meta` at the cube level; type-check sweeps remaining safe |
| Server response someday carries `cube.meta.cdp_source` w/ a different value | Mapping wins per precedence above; documented. Drift surfaces as a verify-mismatch which is exactly the surface designed for it |
