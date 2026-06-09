# Phase 1 — Backend: preview-count + per-segment sweep

## Context links
- Sweep loop: `server/src/care/care-case-sweep.ts:62` `runCaseSweep`; cohort fetcher `:127` `makeCubeCohortFetcher`; VIP-base gate `:31`; fail-closed empty-filter skip `:94`.
- Executor + mutex: `server/src/care/care-sweep-execute.ts:69` `executeSweep`; `inFlight` map `:32`; `SweepBusyError` `:45`.
- Compile pipeline: `server/src/care/playbook-merge.ts:90` `mergePlaybooks`, `:185` `combinePredicates`, `:195` `finalize`; `server/src/care/threshold-rule.ts:103` `compileRule`.
- Routes: `server/src/routes/care-cases.ts:220` POST sweep, `:249` sweep/status; `server/src/routes/care-playbooks.ts:24` registry. Registration `server/src/index.ts:47,49`.
- Game scope + members: `resolveGameScope`, `getGameMembers(ctx, gamePrefix, cacheKey, forceFresh)`.

## Overview
- Priority: P1 (blocks Phases 2 & 3 React).
- Status: pending.
- Two additive backend capabilities, both reusing the EXACT sweep compile/gate path:
  1. `POST /api/care/playbooks/:id/preview-count?game=` — READ-ONLY live count of the cohort a candidate condition would match.
  2. `POST /api/care/cases/sweep?game=&playbook=<id>` — full sweep machinery scoped to ONE playbook (opens/lapses only that segment's cases).

## Key insights
- The count is just `uids.length` from `makeCubeCohortFetcher` — same fetcher the sweep uses. To get a candidate playbook's predicate WITHOUT persisting an override, build a transient `CarePlaybookOverride`-shaped object and run it through `mergePlaybooks` against the live override list, OR (simpler, DRY-safe) reuse `finalize`'s building blocks directly. Chosen approach below uses `mergePlaybooks` with an injected transient override so semantics match 100%.
- `mergePlaybooks(gameId, members, overrides, opts)` accepts an explicit `overrides` array (4th-from-default param) — we can pass `[...listOverrides(game), transientOverride]` or just `[transientOverride]` keyed to the target id, then pick the resolved playbook by id. Passing only the transient override + matching base avoids duplicate-id collisions.
- `compileRule` lives inside `finalize`; we MUST go through merge so calibration + supplemental-predicate AND-combine + availability all apply identically.
- Fail-closed parity: replicate `care-case-sweep.ts:94` — if `treeToCubeFilters(predicate).length === 0`, return `matched: 0, gated: <bool>` with a `note`, never a full-cohort count.
- Availability: if the resolved transient playbook is `unavailable` → 409 (consistent with builder's enable-block), do not query Cube.
- `evalMode === 'trigger'` (ratio rules) → no static cohort → return `matched: null`/409 with clear message ("ratio rules evaluate per-member, no preview count").

## Requirements
### (a) preview-count endpoint — `server/src/routes/care-playbook-preview.ts` (NEW, <120 lines)
- Route: `POST /api/care/playbooks/:id/preview-count?game=<id>`.
- Body (zod-validated): `{ condition: ThresholdRule; supplementalPredicate?: PredicateNode | null }`. `:id` is the display id of the playbook being edited (for seeds it's the seed id; for new playbooks pass `:id = "new"` → build a custom transient with `baseId: null`).
- Flow:
  1. `resolveGameScope(req.workspace, game)` → 400 on bad game.
  2. `ctx = req.buildIntrospectionCtxForGame?.(game) ?? req.cubeCtx`.
  3. `members = await getGameMembers(ctx, scope.gamePrefix, cacheKey, true)` (fresh, like the sweep).
  4. Build transient override:
     ```
     const transient: CarePlaybookOverride = {
       id: `__preview__${id}`,           // synthetic; never persisted
       gameId: game, baseId: id === 'new' ? null : id,
       name: '(preview)', group: 'event', priority: 'tb',
       condition: body.condition,
       watchedMetric: { member: '', label: '' },
       action: { text: '', channels: [] },
       dataRequirements: deriveRequirements(body.condition, body.supplementalPredicate),
       supplementalPredicate: body.supplementalPredicate ?? undefined,
       enabled: true, createdAt, updatedAt,
     };
     ```
     `dataRequirements` MUST include the condition's members + supplemental leaf members (mirror builder's `ruleMembers` + `predicateMembers`) — `makeCubeCohortFetcher` reads `pb.dataRequirements[0]` to pick the cube. Add a small shared `derive-data-requirements.ts` helper if duplication grows; otherwise inline.
  5. `const resolved = mergePlaybooks(game, members, [transient], { calibration: loadCalibration(game) }).find(p => p.id === transient.id)` — if base_id set, the seed will also resolve; pick the override row by synthetic id. (If `baseId` set, transient.id becomes the override of that seed → its resolved `id` equals the seed id; handle by matching on the synthetic — simplest is `baseId: null` ALWAYS for preview so the transient resolves as a `custom` row with a stable id. Use `baseId: null` + copy the condition; availability uses dataRequirements, not base lineage, so this is equivalent.)
  6. Guard: `resolved.availability === 'unavailable'` → 409 `{ code: 'PLAYBOOK_UNAVAILABLE' }`. `resolved.evalMode === 'trigger'` or `!resolved.predicate` → 200 `{ matched: 0, gated: false, note: 'no cohort predicate' }`.
  7. Empty-filter fail-closed: `if (treeToCubeFilters(resolved.predicate).length === 0) return { matched: 0, gated, note: 'empty filter' }`.
  8. `const fetch = makeCubeCohortFetcher(ctx, game, req.workspace.id, members); const t0 = Date.now(); const uids = await fetch(resolved); return { matched: uids.length, elapsedMs: Date.now()-t0, gated: members.has('mf_users.ltv_total_vnd') };`
  9. Cube failure → 502 `{ code: 'PREVIEW_FAILED' }` (same shape family as sweep 502).
- READ-ONLY: never call `applyMembershipResult`, `recordSweep`, profile fetch, or any store write.
- Register in `server/src/index.ts` next to `carePlaybooksRoutes`.

### (b) per-segment sweep
- `runCaseSweep` (`care-case-sweep.ts:62`): add optional 6th param `onlyPlaybookId?: string`. After `mergePlaybooks(...)`, if set: `playbooks = playbooks.filter(p => p.id === onlyPlaybookId)`. Everything else unchanged (skip reasons, idempotent lapse logic still run for that one playbook).
- `executeSweep` (`care-sweep-execute.ts:69`): add optional param `onlyPlaybookId?: string`; thread into `runCaseSweep(game, workspace.id, members, deps, loadCalibration(game), onlyPlaybookId)`. Mutex/record/enrich logic unchanged — profile-enrich still scans all open cases (cheap; harmless). Run record still snapshots; for a single-playbook sweep the run's `summaries` will contain just that playbook — acceptable, the snapshot stays consistent.
- Route `care-cases.ts:220`: read optional `playbook` query param; validate it's a non-empty string if present; pass to `executeSweep(workspace, game, ctx, 'manual', playbookId)`. Response shape UNCHANGED (`{ game, opened, lapsed, profilesRefreshed, summaries }`). Same `SweepBusyError` → 409, same 502 on failure. A per-segment sweep and a full sweep contend on the SAME mutex key → second caller gets 409 (correct).

### (c) tests — `server/test/`
- `care-playbook-preview.test.ts` (NEW): mock cohort fetch by injecting a fake `loadWithCtx` (or test the route handler with a stubbed `makeCubeCohortFetcher`). Assert: (i) count == uids length for an `abs` rule against a jus-like member set; (ii) `unavailable` member set → 409; (iii) ratio rule → `matched: 0` + note; (iv) empty-filter predicate → `matched: 0` fail-closed (NOT full cohort); (v) NO rows written to the case store (`listCases` empty after call).
- Extend `care-case-sweep.test.ts`: `runCaseSweep(..., onlyPlaybookId='02')` opens cases ONLY for `02`; every other playbook absent from summaries.

## Data flow
```
Builder edit → POST preview-count {condition, supplementalPredicate}
  → resolveGameScope → getGameMembers(fresh)
  → mergePlaybooks([transient]) → resolved.predicate (compiled + gated-on-fetch)
  → makeCubeCohortFetcher → loadWithCtx(Trino)  [READ-ONLY]
  → { matched, elapsedMs, gated }

Save & sweep → PATCH/POST playbook (persist) → POST sweep?playbook=<id>
  → executeSweep(onlyPlaybookId) → runCaseSweep filtered → applyMembershipResult (WRITES cases)
  → { opened, lapsed, summaries }
```

## Related code files
- Modify: `server/src/care/care-case-sweep.ts`, `server/src/care/care-sweep-execute.ts`, `server/src/routes/care-cases.ts`, `server/src/index.ts`.
- Create: `server/src/routes/care-playbook-preview.ts`, `server/test/care-playbook-preview.test.ts`.
- Read for context: `playbook-merge.ts`, `threshold-rule.ts`, `availability.ts`, `care-playbooks-store.ts` (`CarePlaybookOverride` type).

## Implementation steps
1. Add `onlyPlaybookId?` to `runCaseSweep` + filter after merge. Run existing sweep tests — must stay green.
2. Thread `onlyPlaybookId?` through `executeSweep`.
3. Add `playbook` query param handling in `care-cases.ts:220`.
4. Create `care-playbook-preview.ts`; register route.
5. Write both test files; run `cd server && npx vitest run care-playbook-preview care-case-sweep`.

## Todo list
- [ ] `runCaseSweep` onlyPlaybookId filter
- [ ] `executeSweep` thread-through
- [ ] sweep route `playbook` param
- [ ] preview-count route + register
- [ ] preview test + sweep-filter test
- [ ] full `vitest run` green

## Success criteria
- Preview returns a count equal to what a real sweep would open for the same condition (manually verify: preview a known `abs` rule, then sweep that playbook, assert opened == matched for a fresh game with no prior cases).
- No case/run/profile rows written by preview-count (asserted in test).
- Full-sweep path byte-compatible (no `playbook` param → identical behavior).
- Per-segment sweep + full sweep cannot run concurrently (409).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Preview count diverges from sweep (different compile path) | M×H | Reuse `mergePlaybooks`+`makeCubeCohortFetcher` verbatim; no second filter builder. Verify via opened==matched check. |
| Transient baseId collision picks wrong resolved row | M×M | Use `baseId: null` always for preview → resolves as `custom` with synthetic id; pick by that id. |
| Cold Trino timeout on preview | M×M | Surface 502 with message; FE shows retry. Same query bound (`limit 50000`, single page) as sweep. |
| Single-playbook run record pollutes trend view | L×L | Acceptable; run snapshot already supports partial summaries. Note in PR. |
| Empty-filter → full-cohort count | L×H | Replicate `care-case-sweep.ts:94` fail-closed guard in preview. |

## Security considerations
- Preview is read-only but still hits live Cube under the introspection/service principal (same as registry route) — gated by `resolveGameScope` (bounds game param, blocks traversal). No per-user cube grant needed (no per-user DATA returned, only a count).
- Sweep route already behind the `/api/care` write rule (editor/admin) — per-segment param does not relax it.

## Next steps
Unblocks Phase 2 (builder wires preview + save&sweep) and Phase 3 React.

## Open questions
1. For `:id = "new"` preview (unsaved playbook) — confirm `condition` alone is enough, or should the FE also send a tentative `dataRequirements`? (Plan derives it server-side from the condition; FE need not send.)
2. Should a per-segment sweep record a full run snapshot or be marked `partial` in the run store? (Plan: record as-is; flag if trend view mislabels.)
