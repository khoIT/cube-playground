---
title: "Chat combined dual-axis artifact (merge two cross-cube queries)"
description: "Chat emits ONE dual-axis artifact merging two same-date-grain Cube queries; opens in builder center chart; pins to dashboard."
status: in-progress
priority: P2
branch: "main"
tags: [chat-service, query-builder, dashboards, dual-axis]
blockedBy: []
blocks: []
created: "2026-06-19T10:32:40.467Z"
createdBy: "ck:plan"
source: skill
---

# Chat combined dual-axis artifact (merge two cross-cube queries)

## Overview

When the assistant answers with two metrics over the same daily date axis (e.g. cfm_vn
`active_daily.paying_dau` + `user_recharge_daily.revenue_vnd_total`, 01–10/06), chat today emits
**two separate single-measure cards**. The two cubes have **no Cube join** (both only join
`mf_users` on user_id; joining through it fans out at user grain → wrong daily aggregates), so they
can never be one `/load`. The merge must be **client-side alignment on the shared date VALUE**.

This plan makes chat emit **one combined artifact** — a dual-axis chart (bar = primary / left axis,
line = overlay / right axis) — that carries **both** CubeQueries so "Open in Playground" lands them
as one artifact whose **center chart** renders the merged dual-axis, and "Pin to Dashboard" persists
it.

## Architecture (post-red-team — the original "reuse compare engine" thesis was wrong)

The red-team proved (file:line) that the compare engine **cannot** be reused for this:
`merge-by-dim-key` keys on the cube-**prefixed** member name (`active_daily.log_date.day`), which
differs between the two cubes → zero overlap; and it only carries the *current* query's measures +
`__cmp/__delta`, never the overlay's distinct measure. So the corrected design:

1. **Merge = alignment on the date VALUE**, not the member name. A small `mergeOnDateValue` util
   (one server-side in chat-service, one FE-side shared by builder + dashboard) strips the cube
   prefix, projects both row sets onto a synthetic `__date` key, and **full-outer** joins over the
   union of dates (dense axis) so neither series silently drops a day. **No `merge-by-dim-key`,
   no `use-compare-results` reuse.**
2. **Render = reuse `AssistantChartSection` (embedded mode)** everywhere — chat card, builder
   center, dashboard tile. It is ResultSet-free, zero chat-coupling, and already renders dual-axis
   from plain rows (`1 category + 2 metrics`). **No net-new renderer.**
3. **ChartSpec** uses the EXISTING `{category, value, series}` encoding (category = date, value =
   primary measure, series = overlay measure). The `dual-axis` variant is added to the Zod union
   with `SeriesEncoding` — NOT a bespoke `{x,left,right}` shape (the FE reads `value`/`series`).
4. **Builder overlay = its own `overlayQuery: CubeQuery | null` builder-state field** — NOT a
   `CompareSetting` variant. The compare engine stays untouched (still prev-period / other-game in
   the Compare tab). Center renders the merged dual-axis when `overlayQuery != null`.
5. **Deeplink stays back-compat**: `payload` remains a single primary CubeQuery; the overlay rides a
   **sibling** sessionStorage key (`gds-cube:pending-chat-deeplink-overlay:<id>`) + `&combined=1`.
   Combined artifacts force `via:'session-storage'` (never the inline `?query=` path).
6. **Deterministic fallback**: on `canMerge` rejection, `emit_combined_artifact` emits the **two
   single artifacts itself** (server-side) — never relies on the model to retry.

## Scope

**In:** (1) chat-service `emit_combined_artifact` + `mergeOnDateValue` + `dual-axis` ChartSpec +
deterministic two-card fallback; (2) artifact carries `overlay` + combined deeplink (sibling key,
forced session-storage); (3) builder `overlayQuery` state + center reuses `AssistantChartSection`
embedded on merged rows; (4) dashboard pin persists overlay (one column, reuse `chart_type`) +
dual-load + tile reuses the same embedded renderer; (5) tests + the mergeability guardrail.

**Out:** >2 measures; cross-cube joins via predefined Cube model joins; non-date join keys; Ops
Console (already hardcodes its own dual-axis trends).

## Locked decisions (user-confirmed)

1. Merged dual-axis renders in the builder **CENTER chart**, not the Compare tab. Compare tab stays
   as-is for prev-period / other-game.
2. **Reuse `AssistantChartSection` (embedded) — do NOT build a new renderer** (red-team H6: it is
   ResultSet-free and portable). Shared chart-value formatters
   (`detectColumnUnit`/`formatAxisValue`/`labelOf`) are imported, never re-ported.
3. Merge allowed **only** when both queries share identical time-dimension granularity + identical
   *resolved* `dateRange` (post-coverage-snap) + disjoint measures; else fall back to two cards.
4. Dashboard pin needs persistence: **one** nullable `overlay_query_json` column; reuse the existing
   `chart_type` discriminator (set `'dual-axis'`) — **drop the redundant `chart_mode`** (red-team
   M12).
5. **Keep all 5 phases** (user kept builder + dashboard surfaces). Re-estimated ~6.5d after red-team.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Chat-service combined emit + server merge](./phase-01-chat-service-combined-emit-server-merge.md) | ✅ Completed (008208c2) |
| 2 | [Deeplink + overlay contract](./phase-02-deeplink-overlay-contract.md) | ✅ Completed (f3dece6a) |
| 3 | [Builder center-chart dual-axis (overlay mode)](./phase-03-builder-center-chart-dual-axis-overlay-mode.md) | ✅ Completed (f3dece6a) |
| 4 | [Dashboard pin persistence](./phase-04-dashboard-pin-persistence.md) | ⏸️ Deferred (user) |
| 5 | [Tests + guardrail fallback](./phase-05-tests-guardrail-fallback.md) | ✅ Completed (fee9a8b9, 73ad2346) — dashboard tile tests deferred with Phase 4 |

> **Status note (260620):** Phases 1–3 + 5 shipped to `main` (no push). Phase 4 (dashboard pin) deferred by user. Live-verified on cfm_vn: one combined dual-axis artifact emitted, persisted to chat.db, round-trips via `GET /sessions/:id` with overlay + `&combined=1`. Code review DONE_WITH_CONCERNS → M1 (single-measure guard) + L2 (token cache key) fixed in 73ad2346.

**Ordering note (red-team C4/B1):** Phase 3 (the `/build` consumer branch + `overlayQuery` state)
must land **before or atomically with** Phase 2's deeplink change — a `{combined}` deeplink reaching
an unaware consumer breaks `/build`. The sibling-key + back-compat `payload` design (decision §5)
makes this safe even if they ship separately, but treat 2+3 as one merge.

## Key references (verified)

- Research: `plans/reports/researcher-260619-1716-querybuilder-center-chart-dual-axis-threading-report.md`
- Research: `plans/reports/researcher-260619-1716-chat-service-combined-artifact-emit-report.md`
- Live repro: chat.db session `57ff05b6-…`, turn 7 (the two cards this plan merges).

## Dependencies

None blocking. Sibling chat plans (`260619-1341-chat-segment-creation`, `260619-1651-chat-
diagnostic-rail`) touch chat-service but different tools/files — no overlap on `emit-*` artifact
files or the builder.

## Red Team Review

3 hostile reviewers (assumption-destroyer, failure-mode, scope/contract), 2026-06-19. 14 findings,
13 accepted (1 rejected: false phase-link-mismatch claim — links match files). All findings carry
`file:line` evidence; full reviewer outputs in session transcript.

**Critical (all accepted, architecture rewritten):**
- C1 `merge-by-dim-key` keys on cube-prefixed member name → no shared key between the two cubes
  (`use-compare-results.ts:124-130`, `merge-by-dim-key.ts:53-64`). → merge on date VALUE.
- C2 compare merge only carries current query's measures, never the overlay's distinct measure
  (`use-compare-results.ts:232`, `merge-by-dim-key.ts:89-101`). → dedicated `{date,m1,m2}` merge.
- C3 `ChartSpec` is a closed Zod union; FE dual-axis reads `{category,value,series}` not `{x,left,right}`
  (`chart-spec.ts:58-92`, `assistant-chart-section.tsx:482`). → use existing encoding.
- C4 `/build` consumer has no `combined` branch; combined payload → malformed Cube query
  (`QueryBuilderContainer.tsx:454-492`). → back-compat payload + sibling key; land consumer first.
- C5 combined deeplink takes inline `?query=` path, `payload` undefined
  (`build-chat-deeplink.ts:32-44`). → force session-storage for combined.

**High (accepted):**
- H6 reuse portable `AssistantChartSection` embedded; **no net-new renderer**
  (`assistant-chart-section.tsx:478-516,33-47`). Reverses the earlier "net-new" correction.
- H7 left-join drops asymmetric date gaps (`merge-by-dim-key.ts:83-102`). → full-outer dense axis.
- H8 per-query coverage-snap can diverge windows (`load-cube-rows.ts:162-191`). → assert snapped
  range equality post-load; refuse on divergence.
- H9 Phase 4 dual-load unbuilt; cache is per-tile not per-query (`tile.tsx:150-158`,
  `refresh-dashboard-tiles.ts:73-85`, `migrations/010-dashboards.sql`). → real dual-load + cache.
- H10 omitted cache-replay consumers corrupt combined charts (`refresh-cached-artifacts.ts:159`,
  `golden-query-seeder.ts:89`). → add to scope.

**Medium (accepted):**
- M12 `chart_mode` redundant with existing `chart_type` (`migrations/026-…:12`). → drop chart_mode.
- M13 don't overload `CompareSetting` with `'overlay'`. → separate `overlayQuery` state.
- M14 rejection-retry referenced non-existent `turn.ts` (loop is `claude-runner.ts`); fallback was
  model-dependent. → deterministic server-side two-card fallback.

### Whole-Plan Consistency Sweep

After applying the findings, all phase files were re-read and reconciled: the "reuse compare
engine / merge-by-dim-key" language is removed from Phases 1, 3, 4; "net-new DualAxisChartRenderer"
replaced by "reuse `AssistantChartSection` embedded"; the `{x,left,right}` encoding replaced by
`{category,value,series}`; `'overlay'` `CompareSetting` replaced by an `overlayQuery` state field;
`chart_mode` removed in favour of `chart_type='dual-axis'`; deeplink payload kept back-compat with a
sibling overlay key; cache-replay consumers (`refresh-cached-artifacts`, `golden-query-seeder`)
added to Phases 1/5; deterministic fallback added to Phase 1. No unresolved contradictions remain.

**Unresolved questions (carry into implementation):**
1. Does `user_recharge_daily.revenue_vnd_total` exist for BOTH cfm_vn and jus_vn? Memory notes a
   revenue-measure parity gap across per-game YAMLs — the guardrail may need a "measure missing in
   game" rejection too, not just grain/range.
2. Coverage-snap divergence (H8): refuse-on-divergence vs re-snap both to the intersection — a
   UX/correctness call to confirm during Phase 1.
3. Dashboard refresh cron loads BOTH queries per dual-axis tile per tick — confirm the tile-refresh
   Cube-load budget tolerates the doubling (Phase 4).
