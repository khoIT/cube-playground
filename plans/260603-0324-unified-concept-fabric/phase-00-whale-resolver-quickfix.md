---
phase: 0
title: "Whale Resolver Quick-Fix"
status: complete
priority: P1
effort: "1d"
dependencies: []
---

# Phase 0: Whale Resolver Quick-Fix (ship first)

## Overview
Kill the term→glossary-index dead-end immediately, standalone, before any registry/trust work. whale/dolphin/minnow already carry `default_filter_json` in the seed; the dead-end is a single `if` in `resolveGlossaryHref` that only branches on `primaryCatalogId`. This phase ships the headline pain fix in ~1 day and de-risks the rest of the plan.

## Requirements
- Functional:
  - Extend the glossary link resolver so a term with no `primaryCatalogId` but a `default_filter_json` (and/or `defaultMeasureRef`) deep-links to a useful destination (Build query pre-filtered by the predicate, or the metric) instead of `/catalog/glossary`.
  - Deep-link to the **specific term** (`/catalog/glossary#<id>` anchor) — never the index top. The anchor scroll/focus handler does **not** exist yet and is part of this phase.
  - whale/dolphin/minnow resolve to a filtered Build/Segment view + their glossary entry.
- Non-functional: pure resolver change + anchor handler; sync (no network); no schema change; no new endpoint. Throwaway-safe — superseded by P3's full `resolveConcept`.

## Architecture
- `resolveGlossaryHref(term)` stays **synchronous** (called inline in JSX `to={…}`). Add fallback branches: `primaryCatalogId` → existing path; else `default_filter_json` → Build route with the predicate encoded; else `defaultMeasureRef` → metric; else `/catalog/glossary#<id>`.
- Glossary index page (`glossary-index-page.tsx`) gains an on-load `#<id>` anchor scroll/highlight so `#whale` lands on the whale row, not the page top.
- No reliance on the registry/trust work — operates on fields already present on the client `GlossaryTerm` type.

## Related Code Files
- Modify: `src/pages/Catalog/glossary/resolve-glossary-link.ts` (fallback branches)
- Modify: `src/pages/Catalog/glossary/glossary-index-page.tsx` (or the glossary list page — `#<id>` anchor scroll/highlight)
- Read: `src/api/glossary-client.ts` (`defaultFilter`/`defaultMeasureRef`/`entityCube` already on the type), `server/data/glossary.seed.json:150-184` (whale/dolphin/minnow `default_filter_json` present)

## Implementation Steps
1. Add resolver fallback: `default_filter_json` → Build route w/ predicate; `defaultMeasureRef` → metric; else term anchor. Keep signature sync + returning `string`.
2. Add `#<id>` anchor scroll/focus to the glossary index page on mount.
3. Verify whale/dolphin/minnow no longer dead-end (filtered Build view + anchored glossary row).
4. Ship standalone (own PR) ahead of P1/P2.

## Success Criteria
- [x] whale/dolphin/minnow no longer dead-end at `/catalog/glossary` top — **decision (user, 2026-06-03):** filter-only concept terms land on their **anchored glossary definition row** (`/catalog/glossary#<id>`), NOT a query builder. A term is a definition first; dropping the user into a near-empty builder (filter, no measure) was judged jarring. The original spec wording ("filtered Build/Segment view") is superseded for measure-less terms.
- [x] Build deep-link reserved for terms that carry a `defaultMeasureRef` → `/build?query=…` pre-seeded with the measure (+ filter if present). The "open as filtered query" affordance for filter-only terms now lives on the glossary row's chip, deferred to P3 for richer treatment.
- [x] `#<id>` anchor lands on the specific term row — index-page hash-scroll + flash on `[data-glossary-id]`
- [x] Resolver stays synchronous; no schema/endpoint change
- [ ] Shipped before P2 registry work begins — implemented + tested on `feat/whale-resolver-quickfix`; PR not yet opened

## Implementation Notes (2026-06-03)
- Modified: `resolve-glossary-link.ts` (fallback: metric → measure→Build → anchored row; op→Cube-operator map), `glossary-index-page.tsx` (hash-scroll/flash), `glossary-row.tsx` (un-gated chip — only shown for metric/Build destinations), `use-glossary-linker.ts` + `assistant-message.tsx` (carry `defaultFilter`/`defaultMeasureRef` to chat term-links).
- The plan's original "Modify" list (resolver + index page only) was under-specified: the row chip gated on `primaryCatalogId` and chat segments dropped the concept-tier fields, so neither surface reflected the new routing without those additive edits.
- **Routing decision:** filter-only term → anchored definition row; measure-bearing term → pre-filtered Build. Whale/dolphin/minnow (filter, no measure) therefore land on the glossary row.
- Tests: `resolve-glossary-link.test.ts` (11) + `use-glossary-linker.test.tsx` (5) pass; full Chat (92) + Catalog (47) suites green earlier; `tsc` adds 0 new errors.

## Risk Assessment
- **Throwaway churn**: P3 replaces this with `resolveConcept`. Mitigation: keep it tiny; the sync `resolveConceptHref` in P3 (red-team C9) is the natural successor — don't over-build.
- **Predicate encoding**: the Build route must accept a single-member filter. If the Build route can't take an encoded predicate cleanly, degrade to the metric (`defaultMeasureRef`) or the anchored glossary entry — still strictly better than the index dead-end.
