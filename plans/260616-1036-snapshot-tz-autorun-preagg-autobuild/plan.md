# Snapshot TZ + auto-run window + pre-agg auto-build

Status: complete · Branch: main · 2026-06-16
All 3 changes implemented + tested (9 new tests, 69 related pass) + code-reviewed clean.

3 scoped changes. Decisions locked via interview:
- Snapshot enable: env in `.env.local`, keep gate (no code-default flip).
- New rollup action: auto-trigger a scoped build, skip already-sealed.
- Started format: `Jun 16, 17:36 GMT+7`.

## C1 — Started column → GMT+7 (display)
`src/pages/Admin/hub/snapshot-run-expandable-row.tsx`
- `run.startedAt` = SQLite `ts` (`datetime('now')` = **UTC**, `YYYY-MM-DD HH:MM:SS`, no tz). Currently rendered raw (line 144) → shows UTC unlabeled, ambiguous JS parse.
- Add `fmtStartedAtGmt7(ts)`: treat source as UTC (`ts.replace(' ','T')+'Z'`), format `en-US` `{month:'short',day:'numeric',hour/minute:'2-digit', timeZone:'Asia/Saigon'}` + ` GMT+7`. Null/invalid → `—`/raw.
- Swap line 144 to use it.

## C2 — Auto-run only 08:00–24:00 GMT+7 + enable
`server/src/jobs/snapshot-segment-membership.ts`
- Add `gmt7Hour(nowMs)` + `WINDOW_START_HOUR=8` / `WINDOW_END_HOUR=24`.
- In `snapshotSegmentMembershipTick`: after enabled/running guard, skip when hour outside `[8,24)`. Daily guard + idempotency unchanged. Manual trigger still bypasses (window irrelevant — explicit human action).
- `.env.local`: `SEGMENT_SNAPSHOT_ENABLED=true` (gitignored; single instance).

## C3 — Pre-agg auto-build for unbuilt rollups
New `server/src/services/preagg-auto-build.ts` (keeps collector small/testable):
- `selectAutoBuildGame(probe, nowMs, lastAttempts, cooldownMs)` → first game with ≥1 `unbuilt` cube not attempted within cooldown; else null. Pure → unit-testable.
- `maybeTriggerAutoBuild(probe, nowMs)`: gated by `PREAGG_AUTO_BUILD_ENABLED`; skip if `getTriggerState().phase==='running'` (single-flight); pick game; `startTrigger(game)`; stamp attempt; log.
Wire into `preagg-run-collector.ts` runPass after step B (probe). Cooldown 6h prevents thrash on rollups that stay unbuilt (failed build / cube_api not reloaded). Already-built rollups never enter unbuilt set ⇒ "ignore if already handled".
- `.env.local`: `PREAGG_AUTO_BUILD_ENABLED=true`.

## Tests (`server/test/`, vitest)
- `snapshot-window.test.ts`: window guard skips 0–7, runs 8–23; manual bypasses.
- `preagg-auto-build.test.ts`: selectAutoBuildGame picks unbuilt, skips all-built, respects cooldown.

## Out of scope
- New-GAME detection (needs games.config edit); cube_api reload for brand-new cubes (probe→error, separate); env knobs for window/cooldown (YAGNI).
