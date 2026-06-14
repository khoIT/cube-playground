# Ops Console Interactive Charts Redesign + Chat Renderer Unification

**Date**: 2026-06-14 19:45 GMT+7
**Severity**: High (deploy dependency: cube dims + restart required)
**Component**: /ops console, chat-service query artifact guarantee
**Status**: Deployed, heatmap blocked pending cube restart

## What Happened

Two feature sets shipped in lockstep (plans 260614-1638 + 260614-2010):

1. **Chat-service query artifact guarantee:** `emit_query_artifact` now ALWAYS attaches a chart spec. When LLM omits/breaks `<chart>`, the server executes the query (`load-cube-rows.ts`, shared with preview path) + derives spec (`derive-chart-spec.ts`: time→line, dim→bar, multi-dim→stacked; null if not chartable). Bug fix: `truncateTopN` now skips time-ordered series (line/area/multi-line) so trends aren't value-sorted into "Other", scrambling the x-axis past 30 points.

2. **Ops console redesign:** Overview trends grid switched from hand-rolled SVG to shared `AssistantChartSection` renderer (unlocks type-switch + CSV + raw table + Open-in-Playground deeplink per-chart). Redesign shrunk trend grid to MAX 2 charts/row (was 3, too cramped). Added 5 new charts: ad-spend-vs-cash, ARPPU+conversion dual-axis, CS volume/sentiment, payer-tier whale heatmap (full-width), purchase hour×day-of-week heatmap (full-width). Members tab refactored: ranked top-payers table above uid search; added custom date-range picker (7d/30d/MTD/custom, capped ≤31 days to guard billing scan).

## The Brutal Truth

We shipped code that depends on cube dims that don't exist yet in prod. The heatmap will silently show a graceful placeholder until the cube dims deploy + serving-instance restarts. This is fine—no user-facing error. But the dependencies are NOT obviously staged. If the cube deploy slips, the feature is incomplete without explanation at handoff.

## Technical Details

**Hour-of-day + day-of-week heatmap requirements:**

Query needs 2 new cube dims on `billing_detail`:
- `hour_of_day` (EXTRACT(HOUR FROM order_created_datetime))
- `day_of_week` (EXTRACT(DOW FROM order_created_datetime), ISO 1=Mon..7=Sun)

**The grain change:** `billing_detail.yml` inner SELECT was GROUP BY at date-only level (1..9). Hour extraction collapses hours → days. To preserve heatmap detail, added EXTRACT(HOUR/DOW) to inner SELECT, expanded GROUP BY to (1..11), AND added both dims to the composite PK.

**Impact:** Widens the base grain ~24× (one row per date→one per date+hour). The existing `billing_detail_daily_batch` pre-agg rolls up over this unaffected (re-aggregates by date, hour dims ignored). Verified safe in code review.

**Deploy sequence (CRITICAL):**
1. Cube dims land in BOTH dev+prod cube registry YAMLs (cfm_vn + jus_vn)
2. Serving instance must restart (DEV_MODE=false = no hot-reload)
3. Heatmap populates; until then shows placeholder + excluded from global error banner

**Frontend workaround:** New `useOpsOverview` hook composes derived metrics (ARPPU, conversion) client-side; null-safe fallback. New builders `overview-trends.tsx` + extracted `ops-members-queries.ts`. Added `headerAction` + `defaultView` props to `AssistantChartSection` (chat path unchanged, backward compatible).

## What We Tried

1. **Inline cube load in heatmap:** Query fails gracefully, placeholder shown. ✓ Deferred dims to cube registry.
2. **Hot-reload dims locally:** Works in DEV_MODE=true, hidden until restart in prod. Documented the gap explicitly.
3. **Month-of-daily chart defaulting to TABLE:** `preferTableView=true` for >12 rows was overriding heatmap default. Fixed via explicit `defaultView="chart"` prop.

## Root Cause Analysis

**Why the grain change was necessary:** The existing `billing_detail.yml` groups at date level because it predates the need for intra-day slices. The heatmap design requires hour+day-of-week to reveal purchase patterns (e.g., peak hours, weekend behavior). Re-deriving these at query time was rejected (expensive Trino SQL, would bloat every billing query). Embedding dims was the pragmatic path.

**Why it stalled deployment:** Cube dims were authored + committed, but the serving instance restart must happen in prod (not just the code). The code-review sign-off assumed a coordinated deploy window; without explicit handoff to ops, it's silent.

## Lessons Learned

1. **Cube grain changes need explicit deploy checklist.** When modifying GROUP BY or adding extraction dims, document the re-aggregation safety proof AND the restart requirement in the PR body, not just in code comments.

2. **Chart placeholders hide incomplete features.** The graceful null fallback is correct UX, but it makes silent failures easy. Track feature-flag gating or add a one-time telemetry ping so ops sees deployment is waiting on a restart.

3. **Shared renderers unlock redesigns fast.** Reusing `AssistantChartSection` (avoiding bespoke SVG) compressed 2 weeks of styling into 2 days. The props (`headerAction`, `defaultView`) are minimal + backward-compatible. Worth the investment.

4. **Custom date-range picker + billing scan guard.** The 31-day cap (`isRangeWithinCap`) is cheap insurance. Business rule lives in code, not a SLA doc.

5. **No-PII boundary hold firm.** `ops-members-queries.ts::topPayersQuery` is isolated—only per-user query in Ops. Code review verified; no query sprawl.

## Next Steps

- **BLOCKING:** Cube dims + serving-instance restart (ops handoff, not dev).
- **Verify:** EXTRACT(DOW) ISO encoding at deploy (1=Mon confirmed locally, cross-check prod Trino version).
- **Monitor:** Watch for heatmap placeholder display ratio; if >10% of sessions, escalate.
- **Future:** Consider caching hour/dow dims at pre-agg layer (billing_detail_hourly_batch) to avoid 24× base grain cost.

## Files Changed

**Core features:**
- `src/pages/Ops/overview-trends.tsx` (new, composed by useOpsOverview)
- `src/pages/Ops/members-top-payers.tsx` (new, isolated top-payers table)
- `src/hooks/use-ops-trends.ts` (new, derives ARPPU/conversion client-side)
- `src/pages/Ops/index.tsx` (redesigned grid, custom date-range picker)

**Chat service:**
- `src/services/chat-service/emit/load-cube-rows.ts` (extracted, shared with preview)
- `src/services/chat-service/emit/derive-chart-spec.ts` (new, auto-derive chart when omitted)
- `src/components/AssistantChartSection.tsx` (props added: headerAction, defaultView)

**Cube models:**
- `cube-dev/cube/model/cubes/cfm/billing_detail.yml` (added hour_of_day, day_of_week dims + GROUP BY)
- `cube-dev/cube/model/cubes/jus/billing_detail.yml` (identical)

**Tests:** 42 ops tests + 1138 chat-service tests pass; tsc clean (90 pre-existing baseline errors untouched).

---

**Status:** DEPLOYED. Heatmap feature code-complete; blocked on cube restart.
