---
phase: 4
title: "Hide tier from UI + chat tool"
status: completed
priority: P2
effort: "1h"
dependencies: [1]
---

<!-- Updated: scope revised — keep tier on the data model; only remove user-visible surfaces (UI + chat tool). -->

# Phase 4: Hide tier from UI + chat tool

## Overview

The `tier` field (T1/T2/T3) is a curation signal that adds noise on metric cards and chat output without driving any current behavior. Remove every user-visible surface for tier while **keeping the field on the data model** (Zod, YAMLs, FE types) so a future Featured-KPIs dashboard / starter-question ranking / watchlist priority can still consume it.

## Requirements

- Functional (UI):
  - `metric-card.tsx` no longer imports or renders `TierBadge`.
  - `metric-list-row.tsx:136` subtitle is `metric.owner` only (drop `Tier {metric.tier} · `).
  - `metric-detail-header.tsx` — verify no tier reference; remove if present.
  - `metrics-filter-rail.tsx` — drop the tier `FilterPillRow` and any active-count term using `filters.tier.size`.
  - `use-filtered-metrics.ts` — drop the tier `Set<number>` from filter state, init, and predicate.
  - `tier-badge.tsx` deleted (no remaining consumers).
- Functional (chat tool):
  - `chat-service/src/tools/list-business-metrics.ts`:
    - Remove the `tier` arg from the Zod input schema.
    - Remove the `if (args.tier !== undefined) metrics = metrics.filter(...)` branch.
    - Remove `tier` from each result row's projected shape.
    - Update the tool description (free-text query is now the only filter).
- Functional (data model — **unchanged**):
  - `tier` stays in `BusinessMetricSchema` Zod.
  - `tier` stays in every preset YAML.
  - `tier` stays in the FE `BusinessMetric` interface — the field is loaded but no UI consumes it.
- Non-functional:
  - No deprecated/unused imports left behind in modified files.
  - Test fixtures that ASSERT on tier UI/chat output updated; fixtures that simply CARRY a `tier: N` value stay (data shape unchanged).

## Architecture

Pure surface removal. The data flows `YAML → loader → API/tool → UI/chat` keep their shape; we just stop reading `metric.tier` in render and prompt paths.

## Related Code Files

### UI surfaces (delete the tier read site)
- Modify: `src/pages/Catalog/metrics-tab/metric-card.tsx` — remove `TierBadge` import + JSX.
- Modify: `src/pages/Catalog/metrics-tab/metric-list-row.tsx:136` — drop `Tier {metric.tier} · ` from subtitle.
- Modify: `src/pages/Catalog/metric-detail/metric-detail-header.tsx` — remove any tier reference (verify via grep first).
- Modify: `src/pages/Catalog/metrics-tab/metrics-filter-rail.tsx` — delete the tier `FilterPillRow`; subtract its term from the active-filter count.
- Modify: `src/pages/Catalog/metrics-tab/use-filtered-metrics.ts` — remove the `Set<number>` for tier and the predicate using it.
- Delete: `src/shared/concept-shell/tier-badge.tsx`.

### Chat tool
- Modify: `chat-service/src/tools/list-business-metrics.ts` — drop `tier` from Zod arg schema, filter logic, result projection, description string, and the inline JSDoc.

### FE types (UNCHANGED in this phase)
- Read for context: `src/pages/Catalog/metrics-tab/business-metric-types.ts` — `tier` stays on the interface; downstream UI just won't read it.

### Tests
- Modify: any test under `src/pages/Catalog/metrics-tab/__tests__/` that ASSERTS on tier badge / tier filter / `Tier N` subtitle text. Fixtures that ONLY carry `tier: N` payloads stay valid.
- Modify: `chat-service/test/` (if any) — test for `list_business_metrics` tier filter is removed.

## Implementation Steps

1. Grep tier read-sites: `rg -n "metric\.tier|TierBadge|Tier {" src/ chat-service/src/`. This is the worklist.
2. UI: edit each file in `Related Code Files` to drop the read. TypeScript will NOT flag these (the field still exists on the type) — rely on the grep for completeness.
3. Chat tool: edit `list-business-metrics.ts`:
   - Zod schema: remove `tier: z.union([z.literal(1), z.literal(2)]).optional()...`
   - TS arg type: drop `tier?: 1 | 2`
   - Filter branch: delete
   - Result projection: drop `tier: m.tier`
   - Tool description: remove "and/or by tier (1 or 2)"
4. Delete `tier-badge.tsx`.
5. `npx tsc --noEmit` — should be clean (data type unchanged, only consumers removed).
6. `npm test` (filter to catalog + chat-service workspaces).
7. Manual smoke:
   - Open `/data-model` → Metrics tab → no tier chips, no tier filter row, subtitle is owner only.
   - Open chat → ask "list our business metrics" → response does NOT mention tier numbers.

## Success Criteria

- [x] `rg -n "metric\.tier|TierBadge|Tier {" src/ chat-service/src/` returns nothing in production code.
- [x] `tier-badge.tsx` removed.
- [x] `BusinessMetricSchema` still has `tier: z.number().int().min(1).max(6)` (preserved).
- [x] All 57 YAMLs still have `tier:` lines.
- [x] `npx tsc --noEmit` shows no new errors.
- [x] Catalog metrics tab + chat list-business-metrics output show no tier signals.

## Risk Assessment

- Risk: another surface beyond the listed read-sites renders tier (e.g. anomaly detector UI, glossary). Mitigation: the initial grep covers `src/` and `chat-service/src/` so any extra hit is caught and either handled in this phase or explicitly punted.
- Risk: a downstream skill prompt (deeper than the tool layer) hand-formats `Tier {n}` from raw payload. Mitigation: grep covers prompt files; result projection no longer carries `tier`, so even if a prompt referenced it, the data is gone.
- Risk: a user has saved a URL/state with `tier` filter selected. Mitigation: removing the field from state init means stored URL params silently get ignored — no error path.
