# Phase 8 · Diff engine: dev↔prod-clone + version-to-version + upstream-staleness

**Priority:** P1 (Track B)
**Status:** pending
**Depends on:** Phase 7 persistence

## Overview
The service layer that powers every diff view the UI renders: dev YAML vs the prod clone (parity), dev YAML version N vs N-1 (temporal), and a staleness check that flags when the local prod clone is behind upstream kraken/cube. All read from git + persisted snapshots; no live GitLab API per request.

## Key insights
- Three distinct diff axes, one shared renderer: (A) dev↔prod — uses the Phase-0 mapping rule (bare→prefixed name) to pair files; (B) dev version history — `git log`/`git diff` on `cube-dev/cube/model/cubes/{game}/{cube}.yml`, falling back to persisted snapshots; (C) prod staleness — compare local clone HEAD sha vs `git ls-remote`/`git fetch` HEAD on kraken/cube.
- Prod source is the local clone (confirmed). The only network touch is an explicit "Refresh from kraken/cube" → `git -C /Users/lap16299/Documents/code/cube-prod pull` (or fetch + report). Everything else is local.

## Requirements
- `server/src/services/cube-model-diff.ts`:
  - `diffDevVsProd(game, cube)` → unified diff + per-field structured diff (PK/joins/measures/rollup), using the mapping rule; handles "no prod counterpart" (oracle-less games / dev-only cubes).
  - `diffDevVersions(game, cube, fromSha, toSha)` → git diff; fallback to persisted snapshot blobs when sha not in git.
  - `listCubeVersions(game, cube)` → commit list touching that file (sha, date, author, subject) for the history picker.
  - `prodCloneStatus()` → local HEAD sha + upstream HEAD sha + behind/ahead count + last-fetch time.
  - `refreshProdClone()` → `git pull` the clone; returns new sha + changed files (guard: read-only on cube-prod otherwise; never push).
- Routes under `server/src/routes/` (e.g. `cube-parity.ts`): GET runs/findings, GET diff (dev-vs-prod | versions), GET prod-status, POST refresh-prod, POST run-audit.
- Reuse the recorder (Phase 7) for run-audit; reuse existing Trino/connector parity helpers only if a live-SQL verify view is added later (out of scope here).

## Architecture / approach
- Structured field diff is computed from the Phase-0 normalized shape (so the UI can show "PK changed: X → Y" not just a text diff), with the raw unified text diff alongside.
- Git operations via a thin exec wrapper with absolute repo paths (cube-playground for dev, cube-prod for prod); no shell interpolation of user input (game/cube validated against the known cube list).

## Related code files
- Create: `server/src/services/cube-model-diff.ts`, `server/src/routes/cube-parity.ts`
- Read: Phase 0 normalizer (shared shape), Phase 7 recorder + snapshot tables
- Read (pattern): existing route + service files under `server/src/routes/`, `server/src/services/`

## Implementation steps
1. Build git exec wrapper (dev repo + prod clone paths; validated args).
2. Implement the 3 diff axes + prod-status + refresh.
3. Wire routes (runs, findings, diff, prod-status, refresh, run-audit).
4. Tests: pairing rule (bare↔prefixed), no-counterpart handling, version diff fallback to snapshot, prod-status behind/ahead math.

## Todo
- [ ] git exec wrapper (validated, read-only on prod except explicit pull)
- [ ] diffDevVsProd / diffDevVersions / listCubeVersions / prodCloneStatus / refreshProdClone
- [ ] routes
- [ ] diff-engine tests

## Success criteria
- dev↔prod diff correctly pairs bare↔prefixed cubes and renders structured + text diff.
- Version diff works from git AND from persisted snapshots.
- prod-status correctly flags a behind clone; refresh updates the sha.
- No accidental writes/pushes to cube-prod.

## Risks
- `git pull` could hit auth/network issues on VPN-only GitLab → fetch is best-effort; surface failure in the UI, fall back to last-known clone state. Concurrent sessions: never run git ops that mutate the dev working tree.

## Next
Routes + diff API → Phase 9 UI consumes them.
