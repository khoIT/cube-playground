# Metric Drift Center Launch — Authz Gap Caught, Surgical Staging Saved Concurrent Work

**Date**: 2026-05-30 14:58
**Severity**: High (authz gap; fixed pre-ship)
**Component**: /drift-center page, detector→store bridge, server routes
**Status**: Shipped (commit 63106d0, 391 server tests pass, FE hook test pass)

## What Happened

Shipped the Metric Drift Center feature — a product surface turning detector's "skipping N metric(s)" log spam into a per-game drift grouping UI with repoint-ref and mark-N/A mutations. All 6 plan phases completed; feature live.

## Design Decisions Built (D1-D5)

- **Drift store key** by (workspace_id, game, source): workspace-independent rows, no cross-game overwrites. Detector rows live at local/detector; live at activeWorkspace/live.
- **Applicability** (per-game N/A toggle) lives in REGISTRY meta.applicability YAML, filtered before grouping on every path — independent of store key.
- **Prod workspaces** (prefix-model) short-circuit with prefixUnsupported:true; prevents false "cube missing" walls since refs are matched verbatim and prod cubes are <prefix>_cube.
- **Detector panel** stays keyed to local game_id model; never merged into live groups; shown in separate detectorPanel only.
- **Repoint picker** chooses from live /meta members; server re-validates `to` ref against /meta as backstop (returns 400 REFS_UNRESOLVED if invalid).

## The Brutal Truth

Code review caught an authz hole the plan missed. The workspace header preHandler assumed it gated game access via x-cube-game header (readGameId), but our new routes take `game` from query/body params. apiFetch never sends x-cube-game, so the upstream check **never fired** — write paths (repoint, applicability) could mint tokens and fetch /meta for *any* game, ungated. On authMode:'none' workspaces, real exposure.

Stung because the plan explicitly sketched route specs but didn't trace authz down to the param-source level. A schema-free path (query/body vs. header) became invisible until code review's "follow the header" trace.

## What We Tried

Fixed with explicit userCanAccessGame guards on all three routes, authz-before-work ordering, + regression test in business-metrics-drift-authz.test.ts. Folded the bug-shape into docs/lessons-learned.md as an existing lesson: "Scope game access server-side — header vs. body param trap" (future-you will spot it faster).

## Root Cause Analysis

Plan assumed upstream auth checks covered downstream param sources. They don't. The gap only surfaced because the feature introduced new routes that don't get x-cube-game from the normal request path. This is a *class* of bug: implicit authz assumptions leak when you ship a route that doesn't inherit the same request shape as the rest of the system.

## Lessons Learned

1. **Plan-to-code authz trace must be explicit.** Don't assume header-based checks cover body/query params. State it: "X header gates Y param" or "Z route adds explicit guards."
2. **Param source matters.** Header vs. query vs. body vs. path triggers different upstream middleware. State the source in the spec.
3. **Surgical staging beats clean-slate add.** During commit, discovered a concurrent session had edited the same shared file (Settings nav). Instead of `git add -A`, built a my-changes-only blob of that file via `git hash-object -w` + `git update-index --cacheinfo`, staged that. Left their WIP untouched in the working tree. Avoids merge-conflict theater and respects their in-flight work.

## Next Steps

- Authz guards live; tests passing; no follow-up needed.
- Lessons-learned entry updated; future drift-like routes will carry the guard pattern forward.
- In multi-session repos, always use `git status` + surgical add by filename; never `git add -A`.

