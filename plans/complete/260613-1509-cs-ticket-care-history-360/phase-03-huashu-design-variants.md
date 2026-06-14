# Phase 3 — Huashu hi-fi design variants (DESIGN GATE)

**Context links:** design system `docs/design-guidelines.md`, tokens `src/theme/tokens.css`, user memory `use-huashu-for-important-ui` / `ui-redesign-design-variants-first`. Reference pages: `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/cohort/index.tsx`, existing care tab `src/pages/Segments/detail/tabs/care-tab.tsx`.

## Overview
- **Priority:** P2 (gate before P4 React build)
- **Status:** pending
- The Care History 360 page is "important/new UI" → per standing rule, design hi-fi HTML variants with **huashu** FIRST, user picks/mixes, THEN Phase 4 builds React from the chosen variant. Variants saved under this plan's `visuals/`.
- **This is a human-decision gate.** Phase 4 is BLOCKED until the user selects a variant.

## Requirements
**Functional**
1. Produce 2–3 hi-fi HTML variants of the full page using huashu, all token-faithful (Inter, `var(--*)`, semantic soft/ink, page-header pattern: `padding:24px 32px`, `maxWidth` 1200, icon+20/700 title, optional eyebrow).
2. Each variant must lay out all locked content blocks:
   - **Header**: back link (→ `/segments/:id?tab=care`), member name + uid, VIP profile chips (tier, vip_game_proportion, gender/dob if present), recharge sparkline (reuse `cs-recharge-trajectory` concept), **security flag banner** when present.
   - **Ticket list / selector** (left or top): tickets w/ label chips, sentiment trajectory badge, ★rating, status, reopen badge, first-response-latency, opened date.
   - **Transcript pane**: player↔CS chat bubbles (is_customer side), attachments (files), handler (staff_dept/domain), timestamps, rating verbatim feedback + structured complaint tags, SLA latency, reopen markers.
3. Show realistic sample content from the jus_vn whales (★1 + free-text, an Account_Security takeover ticket) so the user judges real density.
4. Variants differ in **layout strategy** (e.g. A: master-detail two-pane; B: vertical stacked ticket→transcript accordion; C: timeline-rail + transcript), not just color.

**Non-functional**: self-contained HTML (open in browser, no server). Drift from design-guidelines = reject.

## Related files
**Create**
- `visuals/care-history-360-variant-a.html`
- `visuals/care-history-360-variant-b.html`
- `visuals/care-history-360-variant-c.html` (optional 3rd)
- `visuals/README.md` — one-line description of each variant + the decision prompt for the user.

**Modify/Delete**: none (design-only phase).

## Implementation steps
1. Activate huashu skill; pull tokens from `src/theme/tokens.css` so colors/radii/shadows are exact.
2. Cross-check each variant against an adjacent well-formed page (Dashboards / Cohort) for typography, padding, radius parity.
3. Render with sample whale data (incl. HTML-bubble content, attachments, ★1 verbatim, security takeover).
4. Write `visuals/README.md` framing the pick/mix decision.
5. **STOP — present variants to the user; capture their pick (or mix) before Phase 4.**

## Todo
- [ ] variant A (master-detail two-pane)
- [ ] variant B (stacked accordion)
- [ ] variant C (timeline-rail) [optional]
- [ ] visuals/README.md decision prompt
- [ ] user selects variant (GATE)

## Success criteria
- 2–3 token-faithful HTML variants in `visuals/`, each covering all locked content blocks with realistic data.
- User has picked/mixed a variant; the choice is recorded in `visuals/README.md` for Phase 4.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Variants drift from design system | M×M | tokens pulled verbatim; cross-check vs adjacent page (rule 6 of CLAUDE.md design section) |
| Transcript density unclear until real data | M×M | populate with the actual jus_vn whale shapes, not lorem |
| Phase 4 starts before pick | L×H | hard gate: P4 `blockedBy` P3 in task graph |

## Security
- Sample data only in HTML mocks — use synthetic/sample uids, not real player PII, in the static variants.

## Next steps
- Phase 4 builds the chosen variant into React.
