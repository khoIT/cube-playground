# Phase 04 — Artifact validation sweep service (server)

## Context Links
- Dashboards: `dashboards(owner,game,slug,...)` + `dashboard_tiles(query_json,...)` — `server/src/db/migrations/010-dashboards.sql`
- Segments: `segments(id,name,owner,cube,cube_query_json,...)` — `server/src/db/migrations/001-init.sql`
- Chat artifacts: `chat_turns.artifacts_json` = `QueryArtifact[]`; each has `.game` + `.query: CubeQuery` — `chat-service/src/db/chat-store.ts:347`, `chat-service/src/types.ts:44`
- Member validation: `metric-ref-validator.ts` (`snapshotFromMeta`, `parseFqn`; `validateRefs` is metric-shaped — reuse its resolution loop, not its signature) + `metric-coverage-resolver.ts`
- Probe classify + partition predicate: `preagg-readiness.ts` (from P02)
- **Existing live execution (REUSE, do not re-probe):**
  - `server/src/jobs/refresh-dashboard-tiles.ts` + `dashboard-tile-cache-store.ts` — cron already runs every recently-viewed dashboard tile via `loadWithContinueWait`; failures persist `status='broken'` + error message.
  - `server/src/jobs/refresh-segment.ts` + `segment-status.ts` — segments lifecycle `fresh→refreshing→broken` with `broken_reason` persisted (+ `segment_refresh_log`).
- `bounded-concurrency.ts`, `cube-client.ts` `loadWithCtx`/`getMetaWithCtx`
- Blocked by: Phase 02 (reuses `classifyProbe` + partition predicate)

## Overview
- **Priority:** P2
- **Status:** complete
- **Description:** On-demand (POST) sweep that validates saved artifacts against the
  local workspace's live `/meta` (cheap member-ref check) plus an optional tightened
  live probe, classifying each failing artifact: `missing-member`, `missing-preagg`,
  or `runtime-error`. Reads dashboards + segments (server SQLite) and chat artifacts
  (chat-service runtime DB).

## Key Insights
- **Three-tier validation (cheapest-first, DRY with existing jobs):**
  1. Static member check against a per-game `/meta` snapshot (reuse `snapshotFromMeta`
     + `parseFqn`). A query's `measures`/`dimensions`/`timeDimensions[].dimension`/
     `segments` must all resolve. This is free (no `/load`) and catches the common
     "member renamed/removed" failure. Fetch one `/meta` per game, snapshot it,
     validate ALL artifacts for that game against it.
  2. **Persisted-execution read (dashboards + segments — NO new `/load`):** the tile
     refresh cron already executes every recently-viewed tile and persists
     `status='broken'` + error; segment refresh persists `broken` + `broken_reason`.
     The sweep READS those statuses and classifies the stored error message with
     P02's partition-error predicate → `missing-preagg` vs `runtime-error`. A tile
     with no cache row yet is reported `unverified`, not probed.
  3. Live probe (`limit:1`, narrow `dateRange`) ONLY for chat artifacts — nothing
     else executes them anywhere — and only when the caller asks `live:true`.
     Bounded + opt-in.
- **Artifact → game mapping is already present:**
  - dashboard tile: parent `dashboards.game`; query in `dashboard_tiles.query_json`.
  - segment: `segments.cube` (+ `cube_query_json`); game inferred from cube? Segments
    are owner-scoped, game via the cube's namespace — for game_id workspace, segment's
    game is ambiguous unless stored. **Resolve at impl:** check whether segments carry
    a game column (migration 004-game-scoping). If not, validate the segment's
    `cube_query_json` against the *union* of all games' meta (resolves if any game has it).
  - chat `QueryArtifact.game` is explicit + `.query` is a `CubeQuery`.
- **Reuse, don't reinvent:** member resolution = `parseFqn` + snapshot `.members`.
  Live classify = P02's `classifyProbe`. Do NOT build a new validator.
- **Do NOT hammer the cube.** Static tier needs only `games × 1 /meta` (already what
  readiness does). Live tier is opt-in, bounded ≤2, limit-1. Default `live:false`.
- Chat DB lives in the chat-service runtime (separate process/DB file). The server
  reads it read-only via a path resolved from chat-service config — **scout the exact
  path at impl** (`chat-service/runtime/*.db`). If cross-process read is awkward,
  prefer an internal read-only HTTP call to chat-service if one exists; else open the
  SQLite file read-only. Resolve during impl (open question below).

## Requirements
**Functional**
- `POST /api/workspaces/:id/artifact-sweep` `{ live?: boolean }` → per-artifact-type
  results: `{ dashboards: ArtifactResult[], segments: [...], chatArtifacts: [...], summary }`.
- `ArtifactResult`: `{ kind, id, game, title, status: 'ok'|'missing-member'|'missing-preagg'|'runtime-error', detail?, refs?: string[] }`.
- Only the `local` (game_id) workspace is swept (others → empty + note).
**Non-functional**
- Static tier: ≤ (#games) `/meta` fetches, reuse a single snapshot per game.
- Live tier opt-in, bounded ≤2 concurrent, `limit:1`.
- Fail-open per artifact: a malformed `query_json` → `runtime-error` with detail, never throws the sweep.
- POST (on-demand) only — NO polling, NO continuous sweep (lessons-learned wedge).

## Architecture / data flow
```
POST /api/workspaces/:id/artifact-sweep {live}
  → artifact-validation-sweep.ts: runSweep(db, chatDb, workspace, {live})
      snapshotByGame = fetch /meta per game (reuse buildCtxFor + snapshotFromMeta)
      collect artifacts:
        dashboards+tiles (server db)  → {kind, game, query}
        segments (server db)          → {kind, game?, query=cube_query_json}
        chat artifacts (chat db)      → {kind, game, query}
      for each artifact:
        staticCheck(query, snapshotByGame[game]) → unresolved members?
          unresolved → 'missing-member' (refs listed)
          resolved:
            dashboard tile → read tile-cache status: 'broken'?
                classify stored error (P02 predicate) → 'missing-preagg'|'runtime-error'
                'fresh'→'ok' | no cache row→'unverified'
            segment → read segments.status: 'broken'? classify broken_reason same way
                'fresh'→'ok' | else 'unverified'
            chat artifact → if live: probe(limit=1) → classifyProbe →
                built→'ok' | unbuilt→'missing-preagg' | error→'runtime-error'
                else 'unverified'
      summary counts
```

## Related Code Files
**Create**
- `server/src/services/artifact-validation-sweep.ts` (<200; may split collectors into
  `artifact-collectors.ts` if >200): collectors + static check + live tier + summary.
- `server/src/routes/artifact-sweep.ts`: the POST route, fail-open, registered in the app.
**Read-only**
- chat-service runtime DB (open read-only) — path resolved at impl.
**Modify**
- App route registration (wherever `workspacesRoutes` is registered) to add `artifactSweepRoutes`.

## Implementation Steps
1. Collectors (pure-ish, take a `Database`): `collectDashboardQueries(db, owner, workspace)`
   joins `dashboards`×`dashboard_tiles`, parses `query_json`; `collectSegmentQueries(db, owner, workspace)`
   parses `cube_query_json`; `collectChatArtifacts(chatDb, owner)` parses `artifacts_json`,
   flattens `QueryArtifact[]`, keeps `.game` + `.query`. Each yields a normalized
   `{ kind, id, game|null, title, query: CubeQuery }`. Bad JSON → emit with a sentinel
   so it classifies `runtime-error`, not a thrown sweep.
2. `extractMembers(query)`: collect `measures`, `dimensions`, `timeDimensions[].dimension`,
   filter members, `segments` (segments resolve against snapshot.cubes? — treat segment
   refs as cube-qualified members; if a segment name isn't a `cube.member`, skip it from
   member check). Return fqn list.
3. `staticCheck(query, snapshot)`: for each member fqn, `parseFqn` + check
   `snapshot.members`/`snapshot.cubes` (reuse the validator's logic shape). Return
   unresolved refs.
4. `classifyPersisted(status, errorMessage)`: maps tile-cache / segment statuses —
   `broken` + P02 partition-error predicate on the stored message → `missing-preagg`;
   `broken` otherwise → `runtime-error`; `fresh`/cached-ok → `ok`; no row → `unverified`.
   Collectors for dashboards join the tile-cache rows (`dashboard-tile-cache-store`),
   segment collector reads `segments.status` + `broken_reason`. NO `/load` for these.
5. `liveClassify(query, ctx)` (chat artifacts only): clone query with `limit:1`, narrow
   timeDimension dateRange to 1 day if present; `loadWithCtx`; `classifyProbe`
   (imported from P02) → map `built→ok`, `unbuilt→missing-preagg`, `error→runtime-error`.
6. `runSweep`: short-circuit non-game_id; build snapshotByGame; collect; classify each
   (static always; persisted-read for dashboards/segments; live only for chat artifacts
   when `live:true` and static passed) under `runBounded(_,2)` for the live calls;
   assemble summary `{ total, ok, unverified, missingMember, missingPreagg, runtimeError }`.
7. Route `POST /api/workspaces/:id/artifact-sweep`: parse `live` from body, resolve
   workspace, `getDb()` + chatDb handle, call `runSweep`, fail-open like the readiness
   route (400 unknown workspace, 500 unexpected — but sweep itself never throws).
8. Resolve chat DB access (open question) — open the runtime SQLite read-only with a
   path from chat-service config/env; if unavailable, return chatArtifacts:[] with a
   `note` (fail-open) rather than 500.
9. Tests (`server/test/artifact-validation-sweep.test.ts`): seed an in-memory SQLite
   with dashboards/tiles (+tile-cache rows: fresh, broken-with-preagg-error,
   broken-other, missing) + segments rows (fresh/broken/member-renamed/malformed json);
   mock `getMetaWithCtx` snapshot + `loadWithCtx`; assert classifications, that
   dashboards/segments issue ZERO `/load` calls, and that the live tier fires only for
   chat artifacts when `live:true` and static passed; assert non-game_id short-circuit.

## Todo List
- [x] collectors: dashboards (+tile-cache join), segments (+status/broken_reason), chat artifacts (normalize + bad-json sentinel)
- [x] `extractMembers` + `staticCheck` (reuse parseFqn/snapshot)
- [x] `classifyPersisted` (tile/segment statuses + P02 error predicate; no `/load`)
- [x] `liveClassify` reusing P02 `classifyProbe` (chat artifacts only)
- [x] `runSweep` (static-first, persisted-read, opt-in bounded live, non-game_id short-circuit, summary)
- [x] `POST /api/workspaces/:id/artifact-sweep` route + registration
- [x] chat DB read-only access resolved (fail-open if absent)
- [x] vitest: classifications, live gating, malformed json, short-circuit
- [x] `npm --prefix server run build` passes

## Success Criteria
- Renamed-member query classifies `missing-member` with the offending refs listed.
- Dashboards/segments NEVER trigger a `/load` from the sweep — their verdicts come from
  the persisted tile-cache / segment statuses; a broken tile whose stored error matches
  the partition predicate classifies `missing-preagg`.
- With `live:false` (default), zero `/load` calls — only `/meta` per game.
- With `live:true`, only static-passing CHAT artifacts probe, bounded ≤2, `limit:1`.
- Malformed `query_json` → `runtime-error` for that artifact; sweep still returns 200.
- Non-game_id workspace → empty result + note, no cube calls.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Live tier fan-out wedges cube | M×H | opt-in (`live:false` default), bounded ≤2, limit-1, static gate first |
| Segment game ambiguity → false missing-member | M×M | validate segment query against union of all games' meta; resolve game-column question at impl |
| Chat DB unreadable from server process | M×M | fail-open: chatArtifacts:[] + note; or internal HTTP read if exists |
| Member extraction misses a query field (e.g. order, filters values) | L×M | extract only ref-bearing fields (members), not value literals; unit-test field coverage |
| Cross-process SQLite lock contention | L×L | open chat DB read-only (`readonly:true`) |

## Rollback
Remove the route + service; no schema change, no persisted sweep results (sweep is
ephemeral / on-demand).

## Security
Owner-scoped reads (X-Owner-Id, same contract as readiness). Read-only on both DBs.
No new external target. POST is authenticated by the same middleware as other routes.

## Open Questions
- Chat runtime DB path + access mode from the server process — **RESOLVED**: path is
  `CHAT_DB_PATH` env (same var chat-service reads; default `./runtime/chat.db` relative
  to cwd). Server opens it via `new Database(path, { readonly: true })`. Fail-open when
  absent. In tests the mock throws on readonly opens so chatArtifacts returns [] + note.
- Do segments carry a game column (migration 004-game-scoping)? **RESOLVED**: YES —
  migration 004 added `game_id TEXT NOT NULL DEFAULT 'ptg'` to segments. Sweep uses it
  directly; union-meta fallback is only triggered when `game_id` is NULL.
