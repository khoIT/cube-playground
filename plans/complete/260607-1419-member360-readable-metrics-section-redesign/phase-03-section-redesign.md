# Phase 3 — Implement chosen section redesign (Monetization / Profile & status / Acquisition)

## Context Links
- Chosen variant: **B — “Banded rows”** (user pick 2026-06-07, no tweaks). Monetization =
  single band (big Lifetime LTV + inline LTV-30d / txns / first+last recharge with relative
  sublines) + ratio bar below. Profile & status = grouped KV (Identity / Progression & health
  subheads, status values as soft chips). Acquisition = horizontal 3-step timeline
  (install → first login → last login) + chips row (media source, channel, paid/organic).
  Reference markup: `design/section-variants.html` Variant B zone.
- Section primitives: `src/pages/Segments/member360/sections/dashboard-stats.tsx`
- Page composition: `src/pages/Segments/member360/member-360-view.tsx:167-178`
- Field config: `src/pages/Segments/member360/member360-sections.ts`
- Cache coverage guard: `member-360-view.tsx:59-67` + `profileMembers()` (`member360-sections.ts:131`)
- P2 formatters: `member360/format-cell.ts` (`formatCell`, `formatCellExact`)

## Overview
- Priority: P2. Status: pending. Blocked by P1 (user pick) + P2 (formatters).
- Rebuild the three sections per the chosen variant; dedupe fields; keep config-driven
  per-game shape.

## Requirements
- Implement ONLY the picked variant (+ recorded tweaks). Tokens, Inter, spacing scale.
- Dedupe (subject to variant): drop `is_paying_user` tile (hero badge covers it), drop
  `install_month`, decide engagement/lifecycle home (hero chips vs Profile section — ONE place).
- **Cache rule**: prefer REGROUPING existing fields. Removing fields from section config
  is cache-safe (coverage guard passes on supersets). Do NOT add new `user_profile`
  fields without flagging the precompute-cache miss tradeoff to the user first.
- Derived visuals compute client-side from existing fields (e.g. IAP/Web ratio bar from
  `ltv_iap_vnd`/`ltv_web_vnd`; guard division by zero / null → omit bar).
- New sub-components under `member360/sections/`, kebab-case, < 200 LOC each
  (e.g. `monetization-section.tsx`, `ltv-split-bar.tsx`, `acquisition-timeline.tsx` — names per variant).
- `SectionCard` shell stays (icon + uppercase title) — visual continuity with the rest
  of the page and with 1331-P5 card-shell direction.
- Ballistar: verify both games render (engagement_segment absent path).
- i18n: new labels through `t()` with defaultValue, keys under `segments.member360.*`.

## Related Code Files
- Modify: `member360/member360-sections.ts` (regroup/dedupe field config; per-variant grouping metadata if needed)
- Modify: `member360/sections/dashboard-stats.tsx` (evolve/slim primitives; may shrink to SectionCard + KvList only)
- Modify: `member360/member-360-view.tsx` (section composition swap)
- Modify (maybe, per variant): `sections/dashboard-hero.tsx` (pill value rendering already P2; layout tweaks only if variant requires)
- Create: per-variant section components under `member360/sections/`
- Modify: `src/i18n/en.json` + `vi.json` (new section labels)

## Implementation Steps
1. Record chosen variant + tweaks in Context above.
2. Regroup `member360-sections.ts` config to the variant's structure (typed groups, per game).
3. Build new section components against the config + P2 formatters.
4. Swap composition in `member-360-view.tsx`; delete dead primitive code paths.
5. Verify live on :3000 against a cfm_vn member (the URL in plan context) AND a ballistar member; check dark mode.
6. `npx tsc --noEmit`.

## Todo List
- [x] Variant recorded
- [x] Config regrouped (cfm + ballistar)
- [x] Section components built
- [x] Composition swapped, dead code removed
- [x] Live check both games + dark mode
- [x] tsc green

## Success Criteria
- Page matches the picked variant; no duplicated facts across hero/sections; all values
  readable (compact + relative) with exact tooltips; cached-panel serving still hits
  (network tab: no live `user_profile` query on a cached member).
- Both games render; < 200 LOC per file; tokens only.

## Risk Assessment
- R: variant needs a new profile field → cache-miss until nightly precompute; surface to
  user before adding (Med).
- R: `member-panel.tsx` or details tabs import the slimmed primitives (Med) → grep
  `StatTileGrid|KvList` imports before deleting; keep exports details tabs use.
- R: ratio bar misleading when ltv_iap+ltv_web < ltv (other channels) (Low) → label the
  remainder "other" or render only the two known splits with caption.

## Rollback
- Revert files; config + presentational change only.

## Next Steps
- P4 tests + review.
