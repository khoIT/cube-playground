---
title: "Member 360 — readable metrics + smarter section UI"
description: "Compact human-readable values on hero pills/tiles, relative dates, and redesigned Monetization / Profile & status / Acquisition sections."
status: done
priority: P2
effort: 8h
branch: main
tags: [ui, segments, member360, formatting, design-tokens]
created: 2026-06-07
---

# Member 360 Page — Readable Metrics + Smarter Sections

Same playbook as `260607-1331-segment-detail-ui-redesign`, applied to the per-member
360 page (`/#/segments/:id/members/:uid`). Two workstreams: (1) human-readable values
everywhere the single `user_profile` row is displayed (hero pills, monetization tiles,
KV lists), (2) smarter layout for the Monetization / Profile & status / Acquisition
sections. Design-first for the sections (HTML variants → user pick).

## Constraints (non-negotiable)
- Design tokens only (`var(--…)`), no raw hex (hero gradient whites exempt — existing). One font `var(--font-sans)`.
- Spacing scale: 4/6/8/10/12/14/16/20/24/32/48. Files < 200 LOC.
- No plan-artifact refs in code comments. Conventional commits.
- Pure, unit-testable format utils; vitest tests in colocated `__tests__/`.
- Config-driven per game stays: cfm + ballistar both render from `member360-sections.ts`.

## Phases

| # | Phase | Status | Blocks |
|---|-------|--------|--------|
| 1 | [HTML design variants (3 sections + hero pills)](phase-01-design-variants.md) | done — user picked **B (Banded rows)** | — |
| 2 | [Readable value formatting (compact ₫, relative dates, exact tooltips)](phase-02-readable-value-formatting.md) | done | — |
| 3 | [Implement chosen section redesign](phase-03-section-redesign.md) | done | P2 |
| 4 | [Tests + tsc + code review](phase-04-tests-review.md) | done | P2, P3 |

## Dependency graph
- P1 → P3 (user must pick a variant first). P2 independent of P1; P3 consumes P2's formatters.
- External: sibling plan `260607-1331` P3 creates `formatCompact`/`formatExact` in
  `src/pages/Segments/detail/cards/format-value.ts`. P2 here REUSES that core (DRY).
  If 1331-P3 hasn't landed when P2 starts, P2 creates the shared core in the same
  file (`format-value.ts`) so 1331-P3 then delegates — one core either way.

## File ownership (vs sibling plan 1331 — no overlap)
- P2: `member360/format-cell.ts` (+ shared core in `detail/cards/format-value.ts` only if 1331-P3 not landed), NEW `member360/__tests__/format-cell.test.ts`.
- P3: `member360/sections/dashboard-stats.tsx`, `member360/sections/dashboard-hero.tsx` (pill values only), `member360/member360-sections.ts` (regroup/dedupe fields), possible NEW small section components under `member360/sections/`.
- 1331 owns: `detail/` components, `card-shell.tsx`, charts. No shared files except the opt-in `format-value.ts` core.

## Key gotchas
- Cached panel coverage guard (`member-360-view.tsx:66`): `profileMembers()` derives the
  query/cache key set from section config — REMOVING fields from config shrinks the set
  (cache still serves: guard is `every((m) => m in row0)`, supersets pass). ADDING fields
  breaks cache hits until nightly precompute re-runs → prefer regrouping existing fields.
- `display()` heuristic at `dashboard-stats.tsx:57` (is_*/`_install` → Yes/No) must survive.
- Values must stay STRINGS for `title` tooltip attr; `formatCell` never throws.
- Ballistar variant lacks `engagement_segment` — keep section config per game intact.
