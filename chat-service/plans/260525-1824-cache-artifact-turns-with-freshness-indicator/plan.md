---
title: "Cache artifact-bearing turns + freshness indicator"
status: in_progress
priority: P1
created: "2026-05-25T11:24:00Z"
---

# Cache artifact-bearing turns + freshness indicator

## Goal
Posting the same question twice should reuse the cached assistant response even when the turn produced a Cube query artifact or chart. UI shows a subtle "cached" badge in the message header. Query artifacts re-fetch live Cube data on render (existing FE behavior) — user can always pivot to playground for fresh data. Charts (which embed snapshot data) get a best-effort server-side refresh on cache hit.

## Confirmed scope (AskUserQuestion answers)
- Freshness: **both — server tries fresh, indicator shows refreshed vs stale.**
- TTL: **none.** Cache key already includes `cubeMetaHash`; semantic-layer changes naturally invalidate by rotating the key.
- Indicator: **subtle badge in message header** (timestamp area), like `Assistant · ⚡ cached · 5/25 18:24`.

## Key findings from scout
- `QueryArtifact` does NOT embed Cube rows. FE re-fetches at render → fresh by default after replay. (`emit-query-artifact.ts:119-131`)
- `ChartArtifact` DOES embed `spec.data` rows (snapshot). Has optional `artifactRef → query_artifact.id`. (`services/chart-spec.ts:80-92`)
- Current write-gate skips on `artifacts.length > 0 || charts.length > 0` (`response-cache-write.ts:56-57`).
- Cache key already keys on `cubeMetaHash` (`response-cache-key.ts:59-69`).

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| 1 | [Cache schema + write-gate](./phase-01-cache-schema-and-write-gate.md) | pending |
| 2 | [Replay artifacts + charts via SSE](./phase-02-replay-artifacts-and-charts.md) | pending |
| 3 | [Server-side chart-data refresh on hit](./phase-03-server-side-chart-refresh.md) | pending |
| 4 | [Frontend cached-response indicator](./phase-04-frontend-cached-indicator.md) | pending |

## Cross-phase dependencies
- Phase 2 depends on Phase 1 (schema change for `cache_freshness` + cached value shape).
- Phase 3 depends on Phase 2 (refresh hook runs inside replay path).
- Phase 4 reads `cache_hit` + `cache_freshness` produced by phases 1–3.

## Unresolved questions
- Should Phase 3's refresh apply to ALL charts, or only charts with `artifactRef` (since standalone charts have no query to re-run)? Default: only those with `artifactRef`; standalone charts mark as `stale` deterministically.
