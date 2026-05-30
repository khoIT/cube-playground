# Phase 06 — Tests

## Context
- Runner: `vitest` (`npm run test`). Server tests use `:memory:` / tmp DB via `DB_PATH` — **see lessons-learned "ESM imports hoist above top-level `process.env =`"**: use `vi.hoisted` or `setDb(new Database(':memory:'))` rather than top-level `process.env.DB_PATH =`.
- `NODE_ENV==='test'` disables the detector interval — call detector functions directly.

## Overview
- Priority: P1.
- Status: pending.
- Cover the pure helpers, the store, the three endpoints, the detector bridge, and the page hook. No mocks for the DB (use real `:memory:` per lessons-learned).

## Test matrix
| Unit | What | File |
|---|---|---|
| grouping | 30 cube-missing refs → 1 group, count 30; member-missing per-ref; mixed reasons | `metric-drift-grouping.test.ts` |
| applicability | latest-per-game wins; missing entry = applicable; toggle history | `metric-applicability.test.ts` |
| store | replace-per-`(workspace,game,source)`; detector('local')+live(active) rows coexist; **two workspaces' live rows for same game coexist**; shrinking set; list scope filters | `metric-drift-snapshot-store.test.ts` |
| resolver | N/A cell excluded from drift status + matrix; all-N/A-broken game = ok | extend `metric-coverage-resolver.test.ts` (if exists) or new |
| endpoint: drift-center | groups match validateRefs minus N/A (game_id ws); **`prefix` ws → `prefixUnsupported:true`, groups:[]**; **`detectorPanel` populated separately, NOT merged**; live rows persisted under `(ws.id,game,'live')`; missing `?game=` → 400; 502 on /meta fail | `business-metrics-drift.test.ts` |
| endpoint: repoint | valid repoint 200 + YAML updated + audit row; **target-unresolved 400 backstop (even if picker would have offered it)**; missing `from` 400; ratio/expression slot rewrite | same |
| endpoint: applicability | mark N/A 200 + appended + audit; drift-center then omits it; **N/A excludes across both sources/workspaces** | same |
| authz | viewer PATCH repoint/applicability → 403 (enforce-write-roles) | same |
| detector bridge | `runDetectorOnce`/`scanGameLegacy` persists rows under `('local',game,'detector')`; **`filterApplicable` applied (registry-N/A dropped)**; zero-unresolved clears; store failure doesn't abort | extend `anomaly-detector` test |
| FE hook | `use-drift-center` fetch drift + members → repoint→refetch happy path; **`prefixUnsupported` path renders note**; member list flattened from `/meta` (msw or fetch stub) | `use-drift-center.test.ts` |

## Requirements
### Functional
1. Each pure helper has a unit test (no I/O).
2. Endpoint tests boot the Fastify app (or use `app.inject`) with an in-memory DB and a fixture registry dir (`setRegistryDir(tmp)`), and a stubbed `/meta` (stub `getMetaWithCtx`).
3. Authz test simulates a `viewer` user (or asserts the global preHandler 403s). Check how existing route tests fake `req.user`.
4. Detector bridge test injects a fake `/meta` lacking some cubes/measures and asserts persisted rows.

### Non-functional
- Real `:memory:` DB via `setDb`, never top-level env mutation.
- Fixture YAMLs include: one `cube-missing` (ptg-like), one `member-missing`, one already-resolving, one with `meta.applicability`.
- Endpoint tests fake `req.workspace` for BOTH a `gameModel:'game_id'` and a `gameModel:'prefix'` workspace (assert short-circuit on the latter).
- Store tests cover the cross-workspace isolation case (two `(ws, game, 'live')` scopes coexist) — this is the core mechanism that makes drift workspace-independent.

## Related code files
- Create: test files listed above (kebab-case, co-located in `__tests__/` per repo convention).
- Read for context: existing `server/src/**/__tests__/*` for the app-boot + DB-injection helpers; `src/pages/Settings/__tests__` for FE hook test style.

## Implementation steps
1. Pure-helper unit tests first (fast, no setup).
2. Store test with `:memory:` DB.
3. Endpoint tests via `app.inject` + stubbed `/meta` + tmp registry.
4. Detector bridge test calling `runDetectorOnce` with injected DB + fake meta.
5. FE hook test.
6. `npm run test` green; `npm run typecheck` + `npm run build` green.

## Todo
- [ ] grouping unit tests
- [ ] applicability unit tests (registry-scoped: excludes across workspaces/sources)
- [ ] store tests (replace-per-`(workspace,game,source)`; detector+live coexist; two-workspaces coexist; shrink; scope-filtered list)
- [ ] resolver N/A-exclusion test
- [ ] drift-center endpoint tests (game_id groups; `prefix` short-circuit; separate `detectorPanel`; missing-`game` 400; live-row persistence)
- [ ] repoint endpoint tests (happy + target-unresolved backstop + missing-`from` + ratio + expression)
- [ ] applicability endpoint tests
- [ ] viewer-403 authz test
- [ ] detector bridge test (rows under `('local',…,'detector')`; `filterApplicable` applied)
- [ ] FE hook test (drift + member list + repoint; `prefixUnsupported` note path)
- [ ] full `npm run test` + `typecheck` + `build` green

## Success criteria
- All new tests pass; no existing tests regress.
- Coverage includes each formula type for repoint and the interior "ref resolved this run → row removed" case for the store.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Test wipes dev DB (lessons-learned) | M×H | `:memory:` via `setDb`; never top-level `process.env.DB_PATH=`. |
| Happy-path-only repoint test misses slot bugs | M×M | Explicit per-formula-type cases (measure/ratio/expression). |
| Stubbed `/meta` drifts from real shape | L×M | Reuse `MetaResponse` fixture shape from existing validator tests. |

## Security
- Authz test is itself a security check (viewer cannot mutate).

## Consolidated decisions (all 5 prior opens now DECIDED)
1. **drift-center GET:** SEPARATE "last detector run" `detectorPanel` — NO merge into live groups (D3).
2. **`unparseable` refs:** per-ref (each is a distinct YAML typo) (phase-02).
3. **Page scope v1:** active game ONLY (like `/coverage?game=`); all-games overview deferred to v1.5 (D1 scope).
4. **Detector vs workspace Cube target:** both stay on the local `game_id` model (the only place drift is meaningful — refs matched verbatim, no prefix translation). Detector is NOT repointed onto prod. Active-workspace `prefix` models show a "drift not meaningful (v1.5)" note. Full prefix/prod support is a v1.5 sub-project. Store keyed by `(workspace_id, game, source)` makes drift workspace-independent (D1, D2).
5. **Repoint UX:** searchable dropdown of the active workspace's live `/meta` members (reused `/cube-api/v1/meta?extended=true` proxy, no new endpoint); server still re-validates `to` as a backstop, 400 if unresolved (D4).

## Unresolved
None.
