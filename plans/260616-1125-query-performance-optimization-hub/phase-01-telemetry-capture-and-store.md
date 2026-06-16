# Phase 01 — Telemetry capture + `query_perf` store

## Context
- Capture point: `server/src/routes/cube-proxy.ts` — `forward()` (64-116) does upstream fetch + already classifies 504/502; `emitQueryRun()` (43-51) fires only on 200.
- Telemetry precedent: `server/src/services/activity-store.ts` — `recordActivity` fire-and-forget (195-209), `projectQueryShape` PII gate (86-120), prune (`pruneActivityBefore` 287-290).
- Migrations: `server/src/db/migrations/` (latest 060; new = **061**). Prune cron precedent: `prune-activity-events.ts`.

**Priority:** P1 (blocks all). **Status:** pending.

## Decision: NEW `query_perf` table, NOT extend `activity_events` (justified)
- `activity_events` is the **user-activity spine** (auth audit, segment ops, chat). Query latency is **high-volume time-series** with its own retention/index/sampling needs — mixing pollutes the spine and forces every spine read to filter.
- Separate table = own indexes `(ts)`, `(status)`, `(workspace,game,ts)`; own 30-day retention (shorter than the spine's 90d); own sampling policy. Reuses the SAME write discipline (fire-and-forget, autocommit, swallow) and the SAME `projectQueryShape` PII gate. DRY on behavior, KISS on schema separation. YAGNI: no join to spine needed — perf rows stand alone.

## Data model — migration 061
```sql
CREATE TABLE query_perf (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,                 -- epoch ms
  actor_sub    TEXT    NOT NULL,
  actor_email  TEXT,
  workspace    TEXT,
  game         TEXT,
  method       TEXT    NOT NULL,                 -- 'GET' | 'POST'
  status       INTEGER NOT NULL,                 -- 200 / 400 / 502 / 504 ...
  latency_ms   INTEGER NOT NULL,
  used_preaggs TEXT,                             -- JSON string[] from /load body (may be '[]' for lambda — see P3)
  preagg_hit   INTEGER,                          -- nullable tri-state set in P3: 1 hit / 0 miss / NULL unknown
  query_shape  TEXT,                             -- JSON {cubes,measures,dimensions} via projectQueryShape — NAMES ONLY
  error_excerpt TEXT                             -- first ~200 chars of upstream error body for non-200 (NO query values)
);
CREATE INDEX idx_query_perf_ts            ON query_perf(ts);
CREATE INDEX idx_query_perf_status        ON query_perf(status);
CREATE INDEX idx_query_perf_ws_game_ts    ON query_perf(workspace, game, ts);
```
- `preagg_hit` left NULL at capture; P3's classifier backfills/derives at read time (capture stays cheap). Store `used_preaggs` raw so the classifier has the raw signal.
- `error_excerpt`: capture upstream `body.error` string only, truncate 200ch. It is a Cube/Trino error message (e.g. "timed out after 30s", "Type of value must be timestamp") — never echoes filter values. Guard: if the excerpt could contain a query payload, drop it (defensive substring on known-safe error shapes; default to status text on doubt).

## Implementation steps
1. **Migration `061-query-perf.sql`** — table + 3 indexes above. Follow existing migration file style (plain SQL, run by the numbered-migration runner).
2. **New store `server/src/services/query-perf-store.ts`** (<200 lines), mirroring activity-store:
   - `insertQueryPerf(db, row): void` — synchronous prepared INSERT (throws; tested directly).
   - `recordQueryPerf(input): void` — fire-and-forget wrapper: `try { insertQueryPerf(getDb(), …) } catch` with the SAME `DISK_ERROR_CODES` WARN/debug split as `recordActivity` (209). NEVER throws.
   - `queryPerf(db, opts): QueryPerfRow[]` — filters: `since/until`, `status` (or `statusClass: 'fail'|'success'`), `workspace`, `game`, `limit` (cap 1000). Default `ORDER BY ts DESC`.
   - `pruneQueryPerfBefore(db, cutoff): number`.
   - Reuse `projectQueryShape` + `parseQueryShape` from `activity-store.ts` (import — DRY; do NOT duplicate the PII gate).
3. **Extend `cube-proxy.ts` capture** — replace `emitQueryRun` (43-51) with a `recordQueryRun(req, status, query, latencyMs, body)` that:
   - Computes `latencyMs` via `performance.now()` deltas around the `forward()` call in BOTH GET (140-145) and POST (147-151) `/load` handlers.
   - Captures for **all** statuses (not just 200). For non-200, extract `error_excerpt` from `(body as {error?}).error`.
   - Extracts `used_preaggs`: from a 200 `/load` body, read `body.usedPreAggregations` if present (Cube includes it on the load response); JSON-stringify or `'[]'`.
   - Sampling (see below) applied ONLY to 200s.
   - Calls `recordQueryPerf` — fire-and-forget, NOT awaited, after `reply.send` is queued (mirror current emit placement at 143/149).
   - Context available: `req.principal {sub,email}`, `req.workspace.id`, `gameIdOf(req)` (32-35), raw query via `parseGetQuery`/`req.body.query`.
4. **Prune cron** — add `pruneQueryPerfBefore` to the existing prune scheduler alongside `prune-activity-events`; cutoff = `Date.now() - 30*86400_000`. Reuse the existing daily timer (do NOT add a new scheduler).
5. **`measure-preagg-build.mjs` / no-op** — none here.

## Sampling (perf invariant)
- **Capture ALL non-200s** (the actionable failures — never sampled).
- **Sample 200s** to bound write volume: keep 100% of 200s slower than a `SLOW_MS` threshold (default 3000ms — these are near-misses worth seeing), and a 1-in-N sample (`PERF_SAMPLE_RATE`, default 1/10) of fast 200s. Both env-overridable. Rationale: fast cache hits are uninteresting; slow-but-200 and all failures are the signal. Decision is a pure function `shouldCapture(status, latencyMs)` — unit-tested.
- Insert is a single autocommit statement; even unsampled it's ~sub-ms, but sampling keeps the table small for the time-series indexes.

## Related files
- Create: `server/src/db/migrations/061-query-perf.sql`, `server/src/services/query-perf-store.ts`, `server/src/services/query-perf-store.test.ts`.
- Modify: `server/src/routes/cube-proxy.ts` (capture), the prune scheduler file (add prune call).

## Todo
- [ ] migration 061 + indexes
- [ ] query-perf-store.ts (insert/record/query/prune + reuse projectQueryShape)
- [ ] shouldCapture(status, latencyMs) sampling fn
- [ ] cube-proxy.ts: latency timing + capture all-status + used_preaggs extract + error_excerpt
- [ ] wire pruneQueryPerfBefore into daily prune
- [ ] unit tests (store insert/read/prune, projectQueryShape passthrough, shouldCapture, error_excerpt truncation)

## Success criteria
- A 504 query and a 200 query both produce a `query_perf` row with correct `status`, `latency_ms`, NAMES-only `query_shape`.
- No filter values / dateRange / UIDs in any column (asserted by test feeding a query with `filters[].values` + `uid_list`).
- Proxy response latency unchanged within noise (capture not awaited) — assert emit is post-send.
- Prune removes rows older than 30d.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Capture blocks hot path | L×H | Fire-and-forget, not awaited; single autocommit INSERT; sampling. Mirror recordActivity exactly. |
| PII leak via error_excerpt | M×H | Truncate + only known-safe error shapes; default to status text; test asserts no value leakage. |
| Telemetry write storms fill disk | M×M | 30d retention + daily prune + sampling; DISK_ERROR WARN already surfaces full volume. |
| `usedPreAggregations` absent from load body | M×L | Store `'[]'`/NULL; P3 derives hit by other signals — capture is best-effort. |

## Security
Admin gate is at read time (P2). Capture runs for every authenticated proxy caller — that's intended (any user's query is observed) but only `actor_sub`/`email` + NAMES persisted. No new endpoints in this phase.

## Open questions
1. Does the Cube `/load` 200 body reliably carry `usedPreAggregations` for non-lambda rollups in THIS deployment? (Confirm at integration — if absent, P3 leans entirely on compiled-SQL/heuristic; capture still stores `'[]'`.)
2. `PERF_SAMPLE_RATE` default 1/10 + `SLOW_MS` 3000 — confirm with user or tune after first day of real volume.
