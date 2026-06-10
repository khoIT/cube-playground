# Pre-agg Run History Console — Implementation Report

**Date:** 2026-06-10
**Feature:** Pre-agg Run History Console (plans/260610-1838-preagg-run-history-console)

---

## Files Created / Modified

### Server — new files
| File | Lines | Purpose |
|------|-------|---------|
| `server/src/types/preagg-run.ts` | 65 | Shared TS types: Outcome, SweepSource, PreaggSweepInput, PreaggSweepItem, ParsedSweep, ParsedFailure |
| `server/src/db/migrations/045-preagg-run-history.sql` | 28 | Two tables: preagg_sweep + preagg_sweep_item; indexes; FK cascade |
| `server/src/db/preagg-run-store.ts` | 140 | SQLite store: upsertSweep (idempotent), listSweeps, getSweepWithItems, pruneOlderThan |
| `server/src/services/preagg-run-parser.ts` | 120 | Pure log parser: parseWorkerLog + classifyError |
| `server/src/services/preagg-run-merge.ts` | 150 | Pure merge: 4-outcome taxonomy, cross-game over-warn |
| `server/src/services/docker-log-reader.ts` | 130 | Docker Engine API over unix socket; demuxDockerStream pure helper |
| `server/src/services/preagg-run-collector.ts` | 115 | Orchestration: env-gated interval, degraded mode, probe-snapshot fallback |
| `server/src/routes/preagg-runs.ts` | 65 | GET /api/preagg-runs, /current, /:id — admin-gated |

### Server — modified
| File | Change |
|------|--------|
| `server/src/index.ts` | +import preaggRunsRoutes, +register route, +startPreaggRunCollector after listen |

### UI — new files
| File | Lines | Purpose |
|------|-------|---------|
| `src/types/preagg-run.ts` | 35 | Client-side mirror of server types |
| `src/pages/Admin/hub/preagg-runs-data.ts` | 95 | React hooks: usePreaggRuns, useSweepDetail, useServeabilityNow |
| `src/pages/Admin/hub/preagg-runs-sweep-row.tsx` | 195 | SweepRow + OutcomeChip sub-components |
| `src/pages/Admin/hub/preagg-runs-tab.tsx` | 195 | Full tab: serveability strip, stale banner, KPI row, sweep history list |

### UI — modified
| File | Change |
|------|--------|
| `src/pages/Admin/hub/index.tsx` | +import PreaggRunsTab, +TabDef preagg-runs, +Route /admin/preagg-runs |

### Infrastructure
| File | Change |
|------|--------|
| `docker-compose.local.yml` | server: +volumes /var/run/docker.sock:ro, +env PREAGG_COLLECTOR_ENABLED + PREAGG_WORKER_CONTAINER |

### Tests — new
| File | Tests |
|------|-------|
| `server/test/preagg-run-parser.test.ts` | 15 (classifyError × 7, parseWorkerLog × 8) |
| `server/test/preagg-run-merge.test.ts` | 10 (4 taxonomy + counts + cross-game over-warn + metadata) |
| `server/test/preagg-run-store.test.ts` | 12 (upsert idempotency, list, getSweepWithItems, prune + cascade) |
| `server/test/docker-demux.test.ts` | 9 (frame parsing, truncation, multi-line, empty/short) |
| `server/test/preagg-runs-routes.test.ts` | 10 (auth guard, list/detail/current, 400/404/401/403) |

---

## Test Results

```
server unit + integration:
  157 test files — 1203 tests — ALL PASS

new feature tests:
  preagg-run-parser  15/15
  preagg-run-merge   10/10
  preagg-run-store   12/12
  docker-demux        9/9
  preagg-runs-routes 10/10
  total             56/56
```

Server `npx tsc --noEmit`: **clean** (0 errors).
UI `tsc --noEmit` on new files: **clean** (pre-existing errors in rollup-designer/smart-search unrelated).

---

## Architecture decisions / deviations

1. **Docker socket (not shared log file):** The plan.md spec (shared tee+volume) was superseded by the ARCHITECTURE brief in the task prompt, which explicitly calls for Docker Engine API over unix socket. Implemented per the brief.

2. **Cross-game over-warn surfaced in UI:** The stale/fail attribution is rollup-level (no game ctx in logs). The serveability strip includes an inline italic note: *"failures attributed at rollup level; serveability is per-game"*.

3. **Stale pill not shown in now-strip:** The serveability probe (`computePreaggReadiness`) returns `built`/`unbuilt`/`error` — it cannot distinguish `stale_serving` from `sealed` (both appear as `built`). The `stale_serving` count is correctly computed by the merge function from log+probe. The /current endpoint returns probe-level counts only; sweep-level stale counts appear in the KPI row from the latest sweep row. This is correct: stale detection requires both logs AND probe.

4. **`/api/preagg-runs/current` registered before `/:id`:** Fastify route ordering ensures the literal path wins over the param capture. Tested explicitly.

5. **`probe-snapshot` sweep keyed by pass timestamp:** Since `started_at` is the UNIQUE idempotency key and probe-snapshot passes use `now()`, two passes within the same second would collide. In practice the collector runs every 5 min; this is not a real risk. If needed, add millisecond precision.

---

## Unresolved questions

1. **Retention window** — defaulted to 30 days per the spec. Plan mentions "30 days / prune older" — no user confirmation on record; easily configurable via env var if needed.
2. **`stale_serving` badge count on hub nav** — the plan open question: "Should stale_serving raise anything beyond the UI (e.g. a badge count)?" Not implemented this round; the tab itself is the signal. Trivial follow-up if requested.
3. **Per-partition build durations** — out of scope per plan; trace-only in Cube logs.
4. **Prod stack mirroring** — `docker-compose.prod.yml` not touched this round per plan's out-of-scope note. Socket mount + env vars need to land in the prod registry separately once shape is proven.
