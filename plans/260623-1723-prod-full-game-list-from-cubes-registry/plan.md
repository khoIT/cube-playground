# Prod workspace — full game list from `/cubes` registry (T3)

**Status:** IMPLEMENTED (pending commit) · **Branch:** main · **Date:** 2026-06-23

## Outcome (verified live + tests)
- Admin `/api/admin/registry` → **65 prod games** + 8 local (was 4). ✅
- End-user GamePicker pool now sourced from the workspace roster (readiness/`/cubes`), grant-narrowed; setGameId/cross-device accept prod-only ids. ✅
- Grant matrix: search (>10 opts) + 320px scroll + "N/M selected" + filtered Select-all. ✅
- **Bug fixed:** `cfm_vn` resolves (66 cubes) — was broken by the stale `cfm_vn→cfm` map. ✅
- **Leak fixed (found in review):** the cube-name boundary was single `_` while real cubes are `<id>__<concept>`; `ballistar` readiness over-counted to 89 (merged `ballistar_twid`+`ballistar_vn`). Needle → `${prefix}__` at all meta-filter sites; now 31. ✅ Regression test added.
- Tests: server 38 affected pass + new `prod-game-registry.test.ts` (8); frontend 27 affected pass; server tsc 0 / frontend touched-files 0. 2 pre-existing `concept-reverse-index` failures are unrelated.

## Deferred (separate change — flagged to user)
Member-translation `physicalMember`/`logicalMember`/`physicalCube`/`logicalCube` (both `cube-member-resolver.ts`) and `resolve-identity-field.ts` STILL use the single `_` boundary, which is wrong vs real prod (`__`). This is a **pre-existing** functional bug (produces/strip non-existent member names on prod), has its own tested contract + possible stored-data interactions, and is out of T3's scope. Recommend a focused follow-up to migrate these to `__` + update `cube-member-resolver` tests.

Make the Production workspace expose **all games cube.gds.vng.vn serves (65)** instead of the
hardcoded 4 — automatically across the end-user GamePicker AND `/#/admin/access` — and redesign
the grant UI to handle a long, mostly id-only list (search + scroll).

---

## Verified findings (live cube.gds.vng.vn, 2026-06-23)

1. **`GET https://cube.gds.vng.vn/cubes` → `{"cube_ids":[…]}`** — flat, **open** (no auth), **65 ids**.
   This is the authoritative prod game registry. Far cheaper than 65× `/load` data-probing
   (the old "only games with data" approach is dropped — `/cubes` is the source of truth).
2. **cube_id == member prefix, verbatim.** `cfm_vn` → `cfm_vn__active_daily`, `ptg` → `ptg__recharge`,
   `nikki` → `nikki__balance`. Confirmed across cfm_vn/jus_vn/ballistar/nikki/tlbb2.
3. **🐛 Verified config bug:** prod `gamePrefixMap: { "cfm_vn": "cfm", … }` is **wrong** against
   today's cube.gds — real prefix is `cfm_vn`, not `cfm`. This is exactly why a proxy `/load` for
   cfm_vn returns `Cube 'cfm__recharge' not found`. The other 3 (ballistar/cros/jus_vn) already map
   to themselves (identity). → **The whole map is stale; identity prefixing is correct now.**
4. **`gamePrefixFor()` returns `null` for unmapped prefix games** (`server/src/services/prefix-meta-filter.ts:24`)
   → no `cube_id`+`full=true` scoping, no meta filter. `ptg` only worked because the query string
   already carried fully-qualified `ptg__…` member names. So all 65 games need a real prefix to get
   correctly-scoped `/meta`.
5. Both surfaces derive their prod game list the same way today — from `gds.config.json` (8 games)
   ∩ `Object.keys(gamePrefixMap)` (4) → **prod shows 4**:
   - admin: `availableGamesForWorkspace()` in `server/src/routes/admin-access.ts:55` → `/api/admin/registry`.
   - end-user: `use-game-context.ts` narrows the gds.config pool the same way.

---

## Mechanism (the core change)

**Single new server service `prod-game-registry.ts`** that, for a `gameModel:'prefix'` workspace,
fetches `<workspace.cubeApiUrl>/cubes` (SSRF-safe: URL comes from the workspace def, never the
client), caches it (TTL ~10 min, in-memory), and returns the cube_id list. Both surfaces consume it.

- **Identity prefixing.** Change `gamePrefixFor` to `gamePrefixMap?.[gameId] ?? gameId` when
  `gameModel==='prefix'` (override stays possible; default = identity). **Drop the stale
  `gamePrefixMap` from both workspace configs** (the `cfm_vn→cfm` entry is the bug; the rest are
  identity no-ops). Net: every cube_id from `/cubes` self-prefixes correctly.
- **Game list source becomes workspace-aware:**
  - `gameModel:'game_id'` (local) → `gds.config.json` ids (unchanged).
  - `gameModel:'prefix'` (prod) → cached `/cubes` ids.
- **Metadata fallback.** gds.config supplies name/mark/color for the ~8 known games. The other ~57
  render **id-only**: `label = id`, mark = first 2 chars uppercased, color = deterministic hash of
  id. No curation needed (KISS); gds.config entries still win when present.

---

## Phases

### Phase 1 — Server: prod game registry + identity prefix
- New `server/src/services/prod-game-registry.ts`: cached `fetchProdCubeIds(workspace)` → `string[]`.
  Fail-soft: on fetch error return `[]` (surfaces empty, not a crash) and log once.
- `prefix-meta-filter.ts` `gamePrefixFor`: identity default for prefix workspaces.
- `admin-access.ts` `availableGamesForWorkspace`: for prefix workspaces use `fetchProdCubeIds`
  instead of `Object.keys(gamePrefixMap)`.
- Remove `gamePrefixMap` from `workspaces.config.json` + `workspaces.prod.config.json` (or empty it).
- Tests: `prefix-meta-filter` identity default; admin registry returns 65 for prod (mock `/cubes`);
  cfm_vn now prefixes to `cfm_vn`.

### Phase 2 — End-user GamePicker parity
- `use-game-context.ts`: when active workspace is `prefix`, build the pool from the `/cubes`-derived
  list (via a small `/api/workspaces/:id/games` or fold into existing registry fetch) merged with
  gds.config metadata; still narrowed by per-user `gamesByWorkspace` grant (fail-closed unchanged).
- Verify both chat surfaces / topbar pill react on workspace switch (existing event wiring).

### Phase 3 — Admin grant-matrix redesign for long lists
- `grant-matrix.tsx`: add **search box** (filter by id/label), **scroll container**
  (`max-height ~320px`, `overflow-y:auto` — mirror the chat data-table cap pattern), keep
  Select-all/Clear (operate on *filtered* set), show "N selected / M total" count.
- Render id-only games with the metadata fallback avatar.
- Tokens only (`var(--border-card)`, `var(--bg-card)`, `var(--radius-md)`, etc.); cross-check against
  Dashboards/Cohort per design-guidelines.md.

### Phase 4 — Verify E2E (needs `CUBE_SECRET_PROD`, already wired locally)
- `/api/admin/registry` → 65 games for prod, 8 for local.
- Admin matrix: searchable, scrollable, grants persist (`set_workspace_games`).
- GamePicker on prod lists granted games; cfm_vn `/load` now returns data (prefix bug fixed).
- `npx tsc --noEmit` both packages; targeted vitest.

---

## Files
**Create:** `server/src/services/prod-game-registry.ts` (+ test).
**Edit:** `server/src/services/prefix-meta-filter.ts`, `server/src/routes/admin-access.ts`,
`workspaces.config.json`, `workspaces.prod.config.json`, `src/components/Header/use-game-context.ts`,
`src/pages/Admin/access/grant-matrix.tsx` (+ maybe `workspace-games-section.tsx` for the count/label).

## Risks
- **Removing `gamePrefixMap`** changes prod behavior for cfm_vn (today broken → fixed). Verified correct
  vs live meta, but it reverses a value in committed config → flagged as a decision below.
- `/cubes` unreachable (VPN/prod down) → fail-soft to empty list; admin matrix shows "Nothing available"
  rather than crashing. Local workspace unaffected.
- Long list in topbar GamePicker — search mitigates; confirm picker has a scroll cap too.

## Decisions (locked 2026-06-23)
1. **Drop the stale `gamePrefixMap`; identity-default the prefix.** Removes `cfm_vn→cfm` (verified wrong)
   + the 3 identity no-ops from both configs. `gamePrefixMap` stays supported as an override for any
   future game whose id ≠ prefix.
2. **Auto-derive id-only avatars** for games absent from gds.config (`label=id`, mark=first 2 chars,
   color=hash(id)); gds.config metadata wins for the ~8 known games.
3. **Both surfaces** source from `/cubes` with search; end-user GamePicker still gated by per-user grants.

## Open questions
None.
