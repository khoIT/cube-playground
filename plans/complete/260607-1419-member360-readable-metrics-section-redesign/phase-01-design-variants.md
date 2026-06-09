# Phase 1 — HTML design variants (Monetization / Profile & status / Acquisition + hero pills)

## Context Links
- Page: `src/pages/Segments/member360/member-360-view.tsx:157-178` (hero + 3 sections)
- Section primitives: `src/pages/Segments/member360/sections/dashboard-stats.tsx` (SectionCard, StatTileGrid, KvList)
- Hero pills: `src/pages/Segments/member360/sections/dashboard-hero.tsx:94-122`
- Field config: `src/pages/Segments/member360/member360-sections.ts` (CFM_SECTIONS)
- Design rules: `docs/design-guidelines.md`; tokens: `src/theme/tokens.css`
- Live reference: `http://localhost:3000/#/segments/<id>/members/<uid>` (cfm_vn segment)

## Overview
- Priority: P1 (blocks P3). Status: pending.
- Design-FIRST. 2–3 self-contained HTML variants of the section zone; user picks ONE.

## Current problems the variants must solve
1. **Unreadable numbers**: monetization tiles + hero pills render full `₫10,286,465,000`;
   dates raw ISO with no "how long ago" context.
2. **Redundancy**: `is_paying_user` tile duplicates the hero 💳 Paying badge;
   `engagement_segment`/`lifecycle_stage` KV rows duplicate hero chips; `install_month`
   redundant with `install_date`; first/last recharge dates reappear in journey milestones.
3. **Flat dumps**: Monetization = 9 equal tiles mixing currency/counts/dates/bool —
   no hierarchy. Profile & status = 11 undifferentiated KV rows. Acquisition = 7 KV
   rows that are really a story (install → first login → channel → last login).

## Variant directions (explore at least these)
- **Monetization**: hero stat (Lifetime LTV, compact) + IAP-vs-Web split as a thin
  stacked ratio bar (ltv_iap + ltv_web ≈ ltv) + "last 30d" sub-group (ltv_30d, txns_30d)
  + payer-span line ("paying since Jan 2025 · last paid 3d ago"). Drop the bool tile.
- **Profile & status**: cluster into Identity (country/OS/device/server) ·
  Progression (level, VIP — could be compact stat chips) · Health (days-since-install
  as tenure "412d (~1.1y)", days-since-active as relative). Categorical values as
  soft chips (`--muted-soft`/`--info-soft`), not bold text.
- **Acquisition**: compact vertical mini-timeline (install → first login → last login,
  relative dates) + chips row (media source, first channel, paid/organic). Drop
  install_month.
- **Hero pills**: same pills, values compact (`₫10.29B`, `Lv 78`, `217d`,
  "2d ago" for last active) — show in every variant's header strip for context.

## Requirements
- Token-faithful: resolve light-mode hex from `tokens.css` into the static HTML
  (React impl later uses `var(--…)`). Inter only. Spacing from the scale.
- Realistic sample data incl. overflow currency (₫10,286,465,000 → ₫10.29B) and a
  whale-ish profile (VIP 10, level 78, 400+ day tenure).
- Each variant: one-line rationale + tradeoff. Keep ballistar in mind (no engagement field).
- Dark-mode sanity note per variant (semantic soft tokens only).

## Related Code Files
- Create: `plans/260607-1419-member360-readable-metrics-section-redesign/design/section-variants.html`
- Read only: files in Context Links.

## Implementation Steps
1. Capture real field lists + a real cfm row's values (screenshot or cube probe) for sample data.
2. Resolve token hex values (light mode).
3. Build `section-variants.html`: shared style block; 2–3 full-zone variants (hero strip + 3 sections each).
4. Rationale + tradeoff per variant.
5. STOP. Present to user; await pick. Do NOT start Phase 3.

## Todo List
- [x] Capture real content + sample values
- [x] Resolve token hex
- [x] 2–3 variants in one HTML file
- [x] Rationale per variant
- [x] Present + STOP for user pick

## Success Criteria
- Opens standalone in a browser; 2–3 distinct treatments; compact numbers + relative
  dates visible; redundancy resolved (no duplicate paying/engagement/lifecycle surfaces).
- User has picked a variant (record id + tweaks in phase-03 Context).

## Risk Assessment
- R: variant needs a field not in `user_profile` (Med) → constrain designs to existing
  `member360-sections.ts` fields; ratio bar derives from existing ltv_iap/ltv_web.
- R: user wants hybrid → fold into P3 as chosen spec.

## Next Steps
- Blocks P3. P2 (formatting) can proceed in parallel.
