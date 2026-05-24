---
title: "Pass `?game=` through FE + chat callers"
status: complete
priority: P0
effort: "~1h"
---

# Phase 01 — Pass `?game=` through FE + chat callers

## Context Links

- Resolver: `server/src/services/metric-trust-resolver.ts` (already short-circuits at `if (!gameId) return metrics`)
- Route: `server/src/routes/business-metrics.ts:27-49` (already accepts `?game=` and calls `resolveTrustForGame`)
- Investigation: cube_api logs 2026-05-25 show 67% UserError driven by broken refs the resolver would catch if it fired

## Overview

The resolver and route are already wired but produce no behavior change because every caller fetches `/api/business-metrics` without the `?game=` query param. This phase plumbs `gameId` through the three callers so the resolver actually runs. Smallest possible diff.

## Key Insights

- `useGameContext()` already exposes `gameId` reactively in FE.
- chat-service tools receive a `ctx` object — confirm it carries the active game (it should; both `list-segments` and segment tools already use it for filtering).
- Resolver caches by `gameId`+`metaHash`, so switching games triggers one fresh `/meta` fetch, not N.

## Requirements

- F1. `useBusinessMetrics` accepts (or reads) `gameId` and appends it as `?game=` when present.
- F2. Cache key must include `gameId` — current single-flight + module-level `cache` would otherwise serve another game's adjusted result. Convert cache to `Map<gameId|null, BusinessMetric[]>`.
- F3. Chat tools `list_business_metrics` and `get_business_metric` pass `ctx.game` (or equivalent) as `?game=`.
- F4. Backwards-compat: omitting `gameId` still works and returns declared trust.
- NF1. No new fetches on game switch beyond the necessary cache miss.

## Architecture

```
useGameContext().gameId ──► useBusinessMetrics(gameId) ──► fetch('/api/business-metrics?game='+id)
                                                                      │
chat ctx.game ──► list_business_metrics tool ──► getJson('/api/business-metrics?game='+ctx.game)
                                                                      ▼
                                                       resolveTrustForGame(metrics, gameId)
```

## Related Code Files

- Modify: `src/pages/Catalog/metrics-tab/use-business-metrics.ts`
- Modify: `src/pages/Catalog/metrics-tab/MetricsTab.tsx` (or the consumer that mounts the hook) — pass `gameId`
- Modify: `chat-service/src/tools/list-business-metrics.ts`
- Modify: `chat-service/src/tools/get-business-metric.ts`
- Read for context: `server/src/services/metric-trust-resolver.ts`, `src/QueryBuilderV2/contexts/game-context.tsx` (or wherever `useGameContext` lives)

## Implementation Steps

1. Convert `use-business-metrics.ts` module-level `cache: BusinessMetric[] | null` to `cache: Map<string, BusinessMetric[]>` keyed by `gameId ?? '__none__'`; same for `inflight`.
2. Change `useBusinessMetrics()` signature to `useBusinessMetrics(gameId?: string | null)`; thread the key through `fetchOnce(key)`.
3. Append `?game=<id>` to the URL when `key !== '__none__'`.
4. Update the call site in MetricsTab (and any other consumer) to read `gameId` from `useGameContext()` and pass it.
5. In chat-service, extend the URL builder for `list_business_metrics`: append `?game=` from `ctx.game`. Same for `get_business_metric`.
6. Sanity probe: run `curl 'http://localhost:3000/api/business-metrics?game=ballistar' | jq '.metrics[] | select(.trust=="draft") | .id' | wc -l` and compare to the no-param call.

## Todo List

- [ ] Convert cache to Map keyed by gameId
- [ ] Thread gameId into `useBusinessMetrics`
- [ ] Update MetricsTab + any other call sites
- [ ] Append `?game=` in chat `list-business-metrics`
- [ ] Append `?game=` in chat `get-business-metric`
- [ ] Manual curl probe to confirm draft count differs
- [ ] Verify plan `260525-0012` phase-03 status reflects that `244e19f` shipped the resolver wiring (callers passing `?game=` is the final missing piece this phase closes)

## Success Criteria

- C1. Network tab on Catalog page shows `/api/business-metrics?game=ballistar` (not bare path).
- C2. At least one metric returns `trust:'draft'` from the route when `?game=ballistar` is passed, while same metric returns its declared trust without the param.
- C3. Chat replay tests pass with the new URL.
- C4. Switching games re-fetches once and caches subsequent reads.

## Risk Assessment

- R1. Cache key collision with the existing no-game callers. Mitigation: namespace key with literal `'__none__'` sentinel.
- R2. Game switch races. Mitigation: keep single-flight per key; existing pattern already handles this.
- R3. chat-service `ctx.game` may be undefined on certain entrypoints (replay, raw debug). Mitigation: just omit the param then — resolver falls back to declared trust, no regression.

## Security Considerations

- `?game=` is already validated server-side by `resolveCubeTokenForGame` (returns `null` for unknown games, resolver fails-open). No new attack surface.

## Next Steps

- Unblocks phase-02 (execution guard needs to know which metrics the resolver flagged for the current game).
- Cleanup: when this phase merges, edit `plans/260525-0012-.../phase-03-loader-auto-draft-on-broken-refs.md` `status:` to `complete` (server-side shipped in `244e19f`, callers in this phase close the loop).
