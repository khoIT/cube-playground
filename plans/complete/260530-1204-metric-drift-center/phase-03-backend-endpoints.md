# Phase 03 — Backend Endpoints (grouped drift, repoint, mark-N/A)

## Context
- Host file: `server/src/routes/business-metrics.ts` (already registers `/coverage`, `/scaffold`, `/:id/trust`, `/:id/history`). Add new routes here — file is ~390 lines; if it crosses readability, extract drift routes to `server/src/routes/business-metrics-drift.ts` and register from the same plugin.
- Reuse: `req.buildCubeCtxForGame`, `req.cubeCtx`, `req.workspace`, `getMetaWithCtx`, `validateRefs`, `snapshotFromMeta`, `writeMetric`, `insertAuditRow(getDb(), …)`, phase-02 grouping + store + applicability.

## Overview
- Priority: P1.
- Status: pending.
- Three capabilities: (a) grouped drift read for the page, (b) repoint a broken ref, (c) mark/unmark a metric N/A per game. (b) and (c) are mutations.

## Data flow
- **GET `/api/business-metrics/drift-center?game=<id>`** (active game only — `game` REQUIRED; all-games is v1.5):
  IN active game + active workspace (`req.workspace`, `req.buildCubeCtxForGame`) →
  **branch on `req.workspace.gameModel`:**
  - If `gameModel === 'prefix'` (e.g. prod `:16000`): **skip live reconciliation**; return
    `{ game, groups: [], detectorPanel, prefixUnsupported: true, generatedAt }`. The FE renders
    a one-line note *"drift not meaningful without ref translation (v1.5)"* instead of a wall of
    false `cube-missing`. (Refs are matched verbatim — `metric-ref-validator.ts:99` — and prod
    cubes are `<prefix>_<cube>`, so every metric would otherwise show `cube-missing`.)
  - Else (`gameModel === 'game_id'`, the meaningful path): fetch `/meta` via
    `req.buildCubeCtxForGame(game)` (matches `/coverage`) → `validateRefs` →
    `filterApplicable` (drop N/A; registry-scoped, applies for every workspace) →
    `groupDriftByRootCause` → **persist** live rows via
    `upsertDriftRows({ workspaceId: req.workspace.id, game, source: 'live', rows })` →
    OUT `{ game, groups[], detectorPanel, prefixUnsupported: false, generatedAt }`.
  - **`detectorPanel`** (decision D3 — separate, NO merge): read
    `listDriftRows({ workspaceId: 'local', game, source: 'detector' })`, return as a distinct
    "last detector run saw" block. Live `groups[]` stay authoritative; detector rows only explain
    the detector log. Do not fold them into `groups[]`.
- **PATCH `/api/business-metrics/:id/repoint`** Body `{ from: string, to: string, game?: string, actor?, note? }`:
  IN → load metric → rewrite the matching ref in `formula` (measure.ref | ratio.numerator/denominator | expression.inputs[]) from `from`→`to` → **re-`validateRefs` the *new* `to` ref against the game's live `/meta` as a backstop** (defense in depth — the FE picker D4 already restricts `to` to live members, but `/meta` may shift between fetch and submit; must resolve, else 400 `REFS_UNRESOLVED`) → `writeMetric` → `insertAuditRow(action:'update', reason:'repoint <from> → <to>')` → OUT 200 updated metric. If `from` not present in formula → 400.
- **PATCH `/api/business-metrics/:id/applicability`** Body `{ game: string, applicable: boolean, actor?, note? }`:
  IN → load metric → append `{game, applicable, at: now, actor?, note?}` to `meta.applicability` → `writeMetric` → `insertAuditRow(action:'update', reason:'mark <game> n/a' | 'mark <game> applicable')` → OUT 200 updated metric.

## Requirements
### Functional
1. Grouped drift endpoint reconciles against the **active workspace ctx** for the **active game only** (`?game=` REQUIRED; 400 if omitted). Reuse `resolveCoverageForGame`. All-games iteration is v1.5 — do NOT build it. Branch on `req.workspace.gameModel === 'prefix'` to short-circuit with `prefixUnsupported:true` (see Data flow). Persist live rows under `(req.workspace.id, game, 'live')`.
2. Repoint validates the **target `to`** ref resolves against live `/meta` before persisting — backstop to the FE member picker (re-use the `/trust` certify-gate pattern at `business-metrics.ts:282-318`). Reject 400 `REFS_UNRESOLVED` if target unresolved.
3. Repoint rewrites only the matching slot; preserve formula `type`. Unparseable `from` (no `.`) is still rewritable (string match).
4. Applicability append-only; reading uses latest-per-game (phase-02 helper).
5. Audit every mutation (best-effort insert, log+swallow on failure — match existing pattern).

### Non-functional
- Validation via Zod request schemas (`RepointSchema`, `ApplicabilitySchema`).
- 502 on `/meta` fetch failure; 400 on validation / unresolved target / missing-`from`; 404 on unknown id.

## Related code files
- Modify: `server/src/routes/business-metrics.ts` (add 3 routes; import phase-02 services).
- Maybe create: `server/src/routes/business-metrics-drift.ts` (if host file > ~200 lines added — likely; prefer extraction).
- Read for context: phase-02 store/grouping/applicability; `metric-coverage-resolver.ts`.

## Implementation steps
1. Add `RepointSchema` + `ApplicabilitySchema` (Zod). `game` REQUIRED on the GET query.
2. Implement GET `/drift-center` reusing `resolveCoverageForGame` + grouping. Branch on `gameModel==='prefix'` (short-circuit). Persist live rows under `(workspace.id, game,'live')`; read detector rows under `('local', game,'detector')` into a separate `detectorPanel` (no merge).
3. Implement PATCH `/:id/repoint` (rewrite + re-validate + write + audit).
4. Implement PATCH `/:id/applicability` (append + write + audit).
5. If host file grew too large, move the three handlers into `business-metrics-drift.ts` and `app.register` it.
6. typecheck.

## Todo
- [ ] `RepointSchema`, `ApplicabilitySchema`
- [ ] GET `/api/business-metrics/drift-center`
- [ ] PATCH `/api/business-metrics/:id/repoint`
- [ ] PATCH `/api/business-metrics/:id/applicability`
- [ ] audit rows on both mutations
- [ ] (if needed) extract to `business-metrics-drift.ts`
- [ ] typecheck passes

## Success criteria
- Repointing `funnel.step_count → ordered_event_funnel.step_count` on a metric: 200, YAML updated, ref resolves on re-fetch, audit row present.
- Repoint to a still-missing ref: 400 `REFS_UNRESOLVED`, YAML unchanged (backstop fires even though picker offered only live members).
- Marking `cpi` N/A for ptg: 200, drift-center for ptg no longer lists `cpi`'s group, audit row present.
- Drift-center (game_id workspace) groups match `/coverage` broken-ref set minus N/A; live rows persisted under `(workspace.id, game,'live')`.
- Drift-center on a `prefix` workspace returns `prefixUnsupported:true`, `groups:[]` (no wall of false cube-missing).
- `detectorPanel` is populated from `('local', game,'detector')` rows and is NOT merged into live `groups[]`.
- GET without `?game=` → 400.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Repoint writes YAML then audit fails → silent | L×L | Same best-effort+log contract as existing writes; YAML is source of truth. |
| Drift-center fetches `/meta` on every page load | L×M | Active-game-only (one `/meta` fetch); on-demand, no polling, matches `/coverage`. v1.5 may use the persisted store as a cache. |
| Prefix workspace shows a wall of false cube-missing | M×H | Branch on `gameModel==='prefix'` → `prefixUnsupported:true`, skip reconciliation; verified no ref translation exists (`metric-ref-validator.ts:99`). |
| Ref rewrite corrupts a ratio/expression slot | M×H | Match-and-replace exact `from` string per slot; unit-test each formula type; reject if `from` absent. |

## Security / authz
- All three are under `/api/business-metrics` → the global `enforce-write-roles` preHandler already 403s `viewer` on PATCH/POST (`enforce-write-roles.ts:25-32`). GET drift-center is read, no gate.
- Workspace + game grants enforced upstream in `workspace-header.ts` (`userCanAccessWorkspace`, `userCanAccessGame`) — a user repointing for a game they can't access is 403'd before the handler. **Do not** add redundant per-route role checks; inherit the global gate (DRY, matches `/trust`).
- Prod workspace `authMode:'none'` (open `/meta`) is valid — only block when minted/env token resolves nothing AND authMode !== 'none' (mirror `business-metrics.ts:295`).

## Next
- Phase 05 consumes these endpoints.

## Decided
- **Separate `detectorPanel`, no merge** (D3): live groups authoritative for the active workspace; detector rows shown distinctly.
- **Active game only** (D1 scope): `?game=` required; all-games is v1.5.
- **`prefix` workspaces short-circuit** with `prefixUnsupported:true` (D1).
- **Repoint `to` re-validated as a backstop** to the FE picker (D4).
- **Live rows persisted under `(workspace.id, game,'live')`; detector read under `('local', game,'detector')`** (D2).

## Unresolved
None.
