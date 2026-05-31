---
phase: B
title: "Cross-game executable join (same Trino dataSource)"
status: done
priority: P1
effort: "8h"
dependencies: [A]
---

# Phase B: Cross-game executable join (same Trino dataSource)

## Overview
Let a user model a **real, executable** join between cubes in different games that live under
the **same Trino connector** (e.g. ballistar_vn ⋈ cfm_vn under `game_integration`). This is the
one cross-boundary join Cube can actually run, because both sides share `data_source: trino`
and Trino federates across schemas in one catalog.

## Key insight
- Within one Cube `dataSource`, joins are normal SQL. Trino addresses tables as
  `catalog.schema.table`, so a ballistar cube can join a cfm table by setting the join `sql`
  to a fully-qualified reference — **no cube.js change, no new dataSource**.
- Per decision 3, cubes stay in `cubes/<game>/*.yml`; the cross-game edge is just a join whose
  `sql` references the other game's FQ table. The "owning" game dir is where the join is
  authored (the cube initiating the join).

## Requirements
**Functional**
- In the model builder, when editing a ballistar cube, offer "Join a cube from another game
  (same connector)"; pick target game + cube/table + join keys + relationship.
- Emit a Cube `joins:` entry with `sql` using the FQ `catalog.schema.table` of the target and
  the chosen key condition; relationship (`many_to_one` etc.) selectable with an inferred
  default.
- Validate the resulting model live against `POST /cube-api/v1/load` (a probe query touching
  both sides) before staging — surfaces broken joins early.
- Stage via the existing draft → approve → write pipeline (writes into the initiating game's
  dir).

**Non-functional**
- Only offered when both cubes resolve to the **same `data_source`** (guard in builder).
- User must hold grants for **both** games (RBAC intersection) — else the target game is
  hidden / 403.

## Architecture
- **Builder (FE)** `src/pages/Data/triage/...` + stepper: add a "cross-game join" step that
  lists candidate target cubes from the same connector's other granted games (via a new/existing
  introspect-by-game call). Pre-fill key candidates from inferred FK heuristics
  (`raw-schema-inference.ts`) where available.
- **Scaffolder** `cube-model-scaffolder.ts`: extend join emission to accept a FQ `sql_table`
  reference + explicit ON condition for a cross-schema target (today joins assume same-schema).
- **Validation**: reuse `loadWithCtx` / cube-proxy `/load` with `X-Cube-Workspace`; a bounded
  probe selecting one measure + one dimension from each side.
- **Grant check**: extend the game-grant re-check to require both initiating + target game.

## Related code files
- Modify: `src/pages/Data/triage/*` (builder step), `server/src/services/cube-model-scaffolder.ts`
  (FQ join emission), `server/src/routes/onboarding.ts` (validate probe + dual-grant check).
- Read for context: `cube-dev/cube/cube.js` (single Trino driver, schema-per-game),
  `server/src/services/raw-schema-inference.ts` (FK candidates),
  `server/src/services/cube-model-writer.ts` (write path).

## Implementation steps
1. Confirm FQ cross-schema join executes in this Trino (manual `/load` probe: ballistar ⋈ cfm).
2. Scaffolder: FQ `sql_table` + explicit ON-condition join emission.
3. Builder step: same-connector target picker (granted games only) + key/relationship UI.
4. Dual-game grant re-check on generate/validate/approve.
5. Live-validate probe before staging.
6. Tests: scaffolder FQ-join unit; route dual-grant; (live probe smoke documented).

## Todo
- [ ] Manual proof: FQ cross-schema join runs in Trino
- [ ] Scaffolder FQ-join emission
- [ ] Builder cross-game target picker (granted-games filter)
- [ ] Dual-game grant re-check
- [ ] Live `/load` validation pre-stage
- [ ] tests green

## Success criteria
- [ ] A ballistar⋈cfm cube validates against live Cube and stages a draft.
- [ ] Join offered only for same-`data_source` targets.
- [ ] User lacking the target game's grant cannot pick it (and route 403s if forced).
- [ ] Emitted YAML diff-clean vs cube-dev style; round-trips `CubeModelSchema`.

## Risks
- **Trino cross-schema perms** — the connector's user may lack rights on the other schema →
  surface the `/load` error verbatim; don't silently stage.
- **Wrong relationship cardinality** → default conservatively, require explicit confirm; never
  auto-accept a low-confidence join.
- **FQ name drift** — derive catalog/schema from the connector + `GAME_SCHEMA` map, not
  hardcoded.

## Security
- Dual-grant RBAC; write-role gate; live probe is read-only (bounded).
