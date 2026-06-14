# Phase 3 — 6h Auto-Sweep Cron (fail-soft per game)

## Context links
- Cron template: `server/src/jobs/prune-activity-events.ts` (tick fn, `startX`, boot catch-up), `server/src/jobs/cron-runner.ts` (60s tick scheduler, single-instance)
- Wiring: `server/src/index.ts:228-234` (`startCron()`, `startActivityPruneCron()`, …)
- Sweep core (reused): `server/src/care/care-case-sweep.ts` `runCaseSweep`
- Eligibility: `server/src/care/availability.ts` (`getGameMembers`, `resolveAvailability`)
- Run recording (Phase 2): `server/src/db/care-sweep-run-store.ts`
- Games config: games-config loader (see `games-config-loader.test.ts`)

## Overview
- **Priority:** P2
- **Status:** pending — **depends on Phase 2** (records `source:'cron'` runs)
- Every 6h, sweep each eligible game (4 snapshots/day/game). Fail-soft per game.

## Key insights
- Cron is single-instance, in-process (no advisory lock) — honor that. A new `setInterval` at 6h mirroring `prune-activity-events.ts` is the established pattern.
- Cron runs with NO request — cannot use `req.workspace`, `req.cubeCtx`, `req.buildIntrospectionCtxForGame`, or role gates. Must build the Cube introspection ctx server-side (replicate what the route does without the request). This is the main integration risk — verify how ctx is built outside a request (likely a default-workspace ctx builder; if none exists, extract a pure builder from the route helper).
- "Eligible" = configured game with ≥1 membership playbook resolving `available` (via `availability.ts`). Skip + log otherwise.
- Per-game fail-soft: one game's Trino/Cube error must not abort the loop or kill the tick. `runCaseSweep` is already try/catch internally; wrap each game additionally.
- Concurrency (open Q5): in-process per-game mutex (Set of in-flight gameIds) shared between manual route + cron so a manual sweep and a cron tick don't double-sweep one game. Cron skips in-flight games.

## Requirements
- Functional: tick every 6h (`SWEEP_INTERVAL_MS = 6*60*60*1000`). Boot behavior: do NOT sweep on boot (live 2-min Trino op × all games at startup is wasteful) — first sweep at first interval. For each eligible game: build ctx, getGameMembers(force), runCaseSweep, record run (`source:'cron'`), best-effort profile enrichment (mirror route). Skip in-flight games.
- Non-functional: per-game try/catch; record run `status:'error'` on failure (best-effort) so failures are observable; log start/finish/skip per game. Sequential across games (avoid hammering Trino with N concurrent 2-min ops).

## Architecture
New `server/src/jobs/care-auto-sweep.ts`:
- `careAutoSweepTick(now?)`: load games-config → for each game, resolve eligibility via `availability.ts` → skip unavailable/in-flight → acquire mutex → run sweep + record + enrich (reuse a shared sweep-execute helper) → release mutex. Wrapped per-game.
- `startCareAutoSweepCron()`: `if (interval) return; interval = setInterval(tick, SWEEP_INTERVAL_MS)`. No boot catch-up.
- **DRY:** extract the sweep-execute body (members → runCaseSweep → record run → enrich profiles) shared by the manual route (Phase 2) and the cron into a single `executeSweep(game, workspaceId, ctx, source)` in `care-case-sweep.ts` or a new `care-sweep-execute.ts`. Route passes `source:'manual'`, cron `source:'cron'`. Avoids duplicating the record/enrich logic.
- In-flight mutex: module-level `Set<string>` keyed `${workspaceId}:${game}`, exported, checked by both cron and route.

Data flow: 6h timer → tick → per game [eligible? → not in-flight? → executeSweep → record run] → log summary. No HTTP, no role.

## Related code files
- **Create:** `server/src/jobs/care-auto-sweep.ts`.
- **Create (DRY refactor):** `server/src/care/care-sweep-execute.ts` (shared `executeSweep` + in-flight Set) — extract from Phase 2's route logic.
- **Modify:** `server/src/routes/care-cases.ts` (POST sweep calls `executeSweep(..., 'manual')` instead of inline body — keeps route thin, reuses recording).
- **Modify:** `server/src/index.ts` (add `startCareAutoSweepCron()` near :231; guard behind env if a "disable cron" flag is wanted).
- **Delete:** none.

## Implementation steps
1. Identify/extract a request-free Cube introspection ctx builder for a given game (verify route's `buildIntrospectionCtxForGame` source; if request-bound, factor the pure part out). **Verify before coding** — this is the keystone unknown.
2. Create `care-sweep-execute.ts`: `executeSweep(game, workspaceId, ctx, source)` = members(force) → runCaseSweep → record run/playbook/membership (Phase 2 store) → best-effort profile enrich → return summaries+status. Move in-flight Set here.
3. Refactor POST sweep route to call `executeSweep(..., 'manual')`.
4. Create `care-auto-sweep.ts`: tick iterates games-config, eligibility via availability, per-game fail-soft, skip in-flight, sequential.
5. `startCareAutoSweepCron()` (6h interval, no boot sweep). Wire in `index.ts`.
6. `npm run -w server build`; tests (injectable `now`, fake deps for runCaseSweep + store).

## Todo
- [ ] Verify/extract request-free ctx builder
- [ ] `care-sweep-execute.ts` shared helper + in-flight Set
- [ ] Route refactored to use executeSweep
- [ ] `care-auto-sweep.ts` tick (eligible-only, fail-soft, sequential, skip in-flight)
- [ ] startCareAutoSweepCron + index wiring (no boot sweep)
- [ ] Tests (one game error doesn't abort others; in-flight skip; cron records source:cron)
- [ ] Build clean

## Success criteria
- Tick sweeps every eligible game; ineligible games skipped + logged.
- One game throwing → other games still swept; tick survives; error run recorded.
- Manual sweep during a cron tick on same game → one is skipped (mutex), no double-write.
- Cron-recorded runs show `source:'cron'`.

## Risk + mitigation
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Can't build Cube ctx without a request | M×H | Step 1 verifies/extracts FIRST; if blocked, escalate before building cron |
| N concurrent 2-min Trino ops overload | M×H | Sequential per-game loop, not Promise.all |
| Cron + manual double-sweep one game | M×M | Shared in-flight Set mutex |
| Boot-time mass sweep on every restart | L×M | No boot catch-up; first sweep at first interval |
| Single-instance assumption violated if scaled | L×H | Document assumption; advisory lock is out of scope (matches existing crons) |

## Security
- Runs server-side, no user identity — must not invoke role-gated request helpers. Reads/writes same care tables under server trust. No new HTTP surface.

## Next steps
- Feeds Phase 4 with regular `source:'cron'` runs for trend/diff data density.
