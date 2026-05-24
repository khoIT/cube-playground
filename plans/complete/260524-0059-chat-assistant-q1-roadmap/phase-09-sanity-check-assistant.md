# Phase 09 — Sanity-Check Assistant (F8)

## Context Links
- Brainstorm: §M2 F8.
- Reuses anomaly infra: `server/src/jobs/anomaly-detector.ts`, `server/src/services/anomaly-state-store.ts`, `server/src/services/z-score.ts`.

## Overview
- **Priority:** P2 (M2)
- **Status:** pending
- **Description:** When an agent answer produces a metric value that deviates >Xσ from rolling baseline, flag in the answer with "this looks unusual — confirm?".

## Key Insights
- Anomaly detection already exists for segments (`anomaly-detector.ts` + `z-score.ts`). Reuse, don't fork.
- Q1 scope: per-metric per-game baseline; persisted in `anomaly-state.json` extension or a new table.
- Detect at answer-render time, not background job (Q2 will background-batch).

## Requirements

### Functional
- After query result, server-side check: `|value - baseline_mean| / baseline_std > threshold` (default σ=3).
- Baseline maintained per `(game_id, metric_id)` — rolling N=30 days of daily values.
- UI: yellow banner above result "Value 3.4σ above 30-day average. Common causes: …".
- Banner has "Looks correct" / "Looks wrong" feedback buttons → audit.
- No false flag if baseline N<7 (insufficient data).

### Non-functional
- Check <50ms per result (in-memory cache + one DB lookup).
- Baseline update batch-job nightly (or lazy on access).

## Architecture
- **Service:** `server/src/services/metric-baseline-store.ts` — load/update rolling baselines.
- **Detector:** `server/src/services/sanity-check-detector.ts` — `(metricId, value, gameId) => { isAnomaly, sigma, hint }`.
- **Tool:** `chat-service/src/tools/sanity-check.ts` — called by agent post-result.
- **UI:** `src/pages/Chat/components/sanity-banner.tsx`.

### Schema (new)
```
CREATE TABLE IF NOT EXISTS metric_baseline_daily (
  metric_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,        -- ISO date
  value REAL NOT NULL,
  PRIMARY KEY (metric_id, game_id, day)
);
```

### Data flow
```
query result ─► sanity-check tool ─► detector(metricId, value, gameId)
                                  ↘ baseline-store: last 30 days
                                  ↘ z-score
                                  ─► { isAnomaly, sigma, hint }
result + sanity ─► UI banner (yellow if isAnomaly)
user click feedback ─► audit
nightly job ─► roll baseline forward (insert yesterday's value)
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Z-score util | `server/src/services/z-score.ts` | Direct reuse |
| Anomaly detector | `server/src/jobs/anomaly-detector.ts` | Pattern reference (segment-level) |
| Anomaly state store | `server/src/services/anomaly-state-store.ts` | Pattern reference; new store for metrics |
| Cron | `server/src/jobs/cron-runner.ts` | Nightly baseline roll |
| Query artifact card | `src/pages/Chat/components/query-artifact-card.tsx` | Banner mount point |

### Create
- `server/src/services/metric-baseline-store.ts`
- `server/src/services/sanity-check-detector.ts`
- `server/src/db/metric-baseline-migrate.ts`
- `server/src/jobs/metric-baseline-roller.ts`
- `chat-service/src/tools/sanity-check.ts`
- `src/pages/Chat/components/sanity-banner.tsx`
- `server/src/services/__tests__/sanity-check-detector.test.ts`

### Modify
- `chat-service/src/tools/registry.ts`
- `server/src/jobs/cron-runner.ts` (register nightly roll)
- `src/pages/Chat/components/query-artifact-card.tsx` (mount banner)

### Delete
- None.

## Implementation Steps
1. Schema + migrate for `metric_baseline_daily`.
2. `metric-baseline-store.ts` — `getRolling(metricId, gameId, days)` + `appendDaily(...)`.
3. `sanity-check-detector.ts` — wraps z-score; returns `null` if N<7.
4. Tool wrapper + registry.
5. Agent core: call sanity-check after metric tool calls.
6. `sanity-banner.tsx` with feedback buttons.
7. Cron job nightly: for each `(gameId, metricId)` seen in last 24h, compute daily aggregate via Cube preview, insert row.
8. Tests: detector returns expected sigma; banner renders only when isAnomaly true; cold start (N<7) returns no flag.

## Todo List
- [ ] Schema + migrate
- [ ] `metric-baseline-store.ts`
- [ ] `sanity-check-detector.ts`
- [ ] `sanity-check` tool
- [ ] Banner UI
- [ ] Cron baseline roller
- [ ] Tests

## Success Criteria
- False-positive rate <10% in QA matrix (banner shown when truly anomalous).
- 0 banners shown when N<7 (cold-start gate).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Baseline corruption from outliers | Med | Med | Trim top/bottom 2% before z-score. |
| Cron N+1 query per metric | High | Med | Batch — single query per game, group by metric. |
| Banner fatigue | Med | Low | Per-user suppression after 3 dismisses on same metric. |

## Security Considerations
- Baseline values are aggregates — no PII.
- Feedback events recorded in audit; no free-text.

## Next Steps
- Blocked by: phase-06 (plan output produces metric ids), phase-05 (cron infra shared).
- Independent of phase-07, 08.

## Rollback
Disable tool registration + cron job; baselines remain (read-only).
