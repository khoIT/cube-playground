# Code Review — Metric Drift Center

Date: 2026-05-30 | Reviewer: code-reviewer | Scope: changed/new files only (per request)

## Verdict: DONE_WITH_CONCERNS

Implementation is solid, matches plan decisions D1–D5, design-system clean, tests/typecheck green per provided context. No critical (data-loss / injection / breaking) bugs in the new code. Concerns below are 1 medium authz item (mostly inherited) + minor UX/robustness gaps.

---

## Design decisions — verified against code

- **D1 prefix short-circuit** — OK. `business-metrics-drift.ts:122` returns `prefixUnsupported:true` with empty `groups` before any coverage fetch. FE renders info note + detector panel only (`index.tsx:145`). No false `cube-missing` wall.
- **D2 store keyed (workspace,game,source)** — OK. Migration UNIQUE + DELETE scoped to the exact tuple (`metric-drift-snapshot-store.ts:80-83`); replace-per-scope atomic in a tx. Detector writes `('local',game,'detector')`, live writes `(req.workspace.id,game,'live')`.
- **D3 detector panel separate** — OK. `detectorPanel` built from `source:'detector'` rows only; never merged into live `groups`. FE renders distinct dashed panel.
- **D4 repoint backstop re-validate** — OK. `:repoint` re-fetches `/meta` and checks `snapshot.cubes.has(p.cube) && snapshot.members.has(p.fqn)` (matches validator semantics at `metric-ref-validator.ts:100,103`); 400 `REFS_UNRESOLVED` on miss.
- **D5 applicability registry-scoped, filtered pre-group** — OK. Live path filters via `isApplicable` passed into `resolveCoverageForGame`; detector path filters via `filterApplicable` before `upsertDriftRows`. Both exclude N/A before persist/group. `applicableForGame` latest-entry-wins logic correct.
- **RBAC inherit** — OK. `/api/business-metrics` is in `PROTECTED_PREFIXES`; `enforce-write-roles` gates PATCH for viewers (403). GET ungated (read-only). Registered after the gate in `index.tsx:56` then `:76`.

---

## Findings (ranked)

### MEDIUM — game-grant check bypassed on `?game=` / body `game` (mostly inherited)
`workspace-header.ts` `onRequest` only runs `userCanAccessGame` against the `x-cube-game` **header** (`readGameId`, line 53-58). The drift routes take `game` from the **query** (GET drift-center) and **body** (PATCH repoint), then call `req.buildCubeCtxForGame(game)`, which mints a Cube token for that game with **no grant check**. An authenticated user could reconcile / repoint-validate against a game outside their grants by passing `?game=` / `{game}`.
- Read side is **pre-existing**: `/coverage` (`business-metrics.ts:96`) uses the exact same pattern, so per "skip pre-existing" this is inherited, not introduced.
- The **PATCH repoint** is a *new* write path that takes `game` from the body and mints a token for it. It is write-role gated (editor+) but not game-grant gated. cube-dev's per-user `checkAuth` (token minted under user email, `workspace-header.ts:117`) may double-enforce on minted/auth workspaces, blunting impact — but on `authMode:'none'` workspaces there is no second gate.
- Recommend: validate the resolved `game` against `userCanAccessGame(req.user, game)` inside the drift routes (and ideally fold query/body game into the central check). Low effort, closes the new write path.

### LOW — N/A is one-way in the UI (no un-mark)
`MarkNaToggle` only ever calls `onMarkNa(id,false)`; no UI path sends `applicable:true`. Once marked N/A the metric drops out of live groups and cannot be reverted from Drift Center. Server endpoint supports `true`. Acceptable for v1 but a dead-end for misclicks — consider a re-enable affordance (or note it as known).

### LOW — body `actor` silently overrides agent identity
Both PATCH handlers: `actorKind: actor ? 'user' : a.kind`. If a caller sets header `x-actor-kind:agent` but also passes `actor` in body, the audit row is labelled `user`. Edge case; only affects audit attribution fidelity.

### LOW — `affectedCount` recomputed redundantly
`metric-drift-grouping.ts:86` overwrites `affectedCount` with `affectedMetricIds.length` after the loop already maintained it — harmless, the loop-time value is never read. Cosmetic.

### INFO — repoint `from` selector resilience
`RepointRefForm` keeps `fromIdx` in state across refetches; guarded by `items[fromIdx] ?? items[0]`, so a shrunk `items[]` can't crash but the selection may silently jump. Fine for v1.

### INFO — live-snapshot persist swallows errors
`drift-center` GET wraps `upsertDriftRows` in try/catch and logs warn (intentional, non-fatal per comment). Correct call — a SQLite hiccup must not blank the report. Same pattern in detector bridge. Good.

---

## Positives

- Store DELETE strictly scoped to single tuple — verified it cannot wipe another workspace/source. Tx wraps delete+insert (atomic).
- `filterApplicable` keeps refs for unknown metric ids (doesn't silently swallow drift) — good defensive default.
- Detector bridge persists `rows:[]` to clear now-resolved games (no stale drift) and is best-effort wrapped so a SQLite error can't abort the scan loop.
- All styling via design tokens; every `var(--…)` used by the 5 new components is defined in `src/theme/`. Header recipe (eyebrow + 20px/700 title + icon, 24px/32px padding, centered maxWidth) mirrors Dashboards. No raw hex, single Inter stack.
- repoint re-validation uses the same `parseFqn`/`snapshot.members` contract as the validator, so picker-vs-backstop semantics can't diverge.
- FE meta picker reuses `useCatalogMeta` which scopes to active game via `x-cube-game` — members offered are correct for the selected game.

---

## Unresolved questions
1. Is the game-grant bypass on the new repoint write path acceptable because cube-dev `checkAuth` double-enforces on auth workspaces? If any `authMode:'none'` workspace is reachable by non-admins, it is not. (Owner call.)
2. Is one-way N/A intended for v1, or should an un-mark affordance ship now?
