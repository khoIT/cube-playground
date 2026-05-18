---
phase: 4
title: "Header middle pills + mobile dropdown"
status: completed
priority: P1
effort: "2h"
dependencies: [2, 3]
---

# Phase 4: Header middle pills + mobile dropdown

## Overview

Replace the current `PillRow` (Playground / Models / Catalog) with the three target pills: **Playground**, **New Metric**, **Catalog**. Center the row in the header (between BrandBlock and the right cluster). Update mobile dropdown to match. Translate pill labels via i18n.

## Requirements
- Functional: three pills centered visually. Active state matches current route. "New Metric" pill routes to `/metrics/new?v=2` (same target the existing `NewMetricButton` uses). "Catalog" pill routes to `/catalog`; remains active for `/catalog/models` (phase 6 sub-route).
- Non-functional: pill style matches Image #3 — orange filled when active, neutral when idle, 32 px tall, soft radius. Mobile (< 992 px) collapses to the existing dropdown trigger.

## Architecture
- `Header.tsx`: layout = `BrandBlock | Spacer | <PillRow centered> | Spacer | <RightCluster>` (the right cluster lands in phase 5; this phase leaves a stub placeholder div on the right). The two-Spacer pattern keeps the pills visually centered.
- `NavPill` already supports active + icon; reuse. Add `lucide-react` icons: `LayoutDashboard` (Playground), `Sparkles` (New Metric), `BookOpen` (Catalog).
- Active detection for `/metrics/new`: extend `isActive` (which already does prefix match) — verify `/metrics/new/success` keeps the pill active too.

## Related Code Files
- Modify: `src/components/Header/Header.tsx`

## Implementation Steps
1. Import `Sparkles` from `lucide-react`. Drop `Database` (Models pill removed).
2. Change the desktop `PillRow` children to three `<NavPill>`s with `to="/build"`, `to="/metrics/new"`, `to="/catalog"`.
3. Use `t('nav.playground')` / `t('nav.newMetric')` / `t('nav.catalog')` for labels.
4. Add a second `<Spacer />` after `PillRow` so the row stays centered between BrandBlock + the right cluster.
5. Update the mobile `Dropdown` `<Menu>` items to match (drop Models entry, add New Metric).
6. Manual sanity: navigate to `/build`, `/metrics/new`, `/catalog`, `/metrics/new/success` — verify correct pill is highlighted in each case.

## Success Criteria
- [ ] Three pills render in the desktop header at >= 992 px, visually centered.
- [ ] Each pill highlights when the corresponding route is active.
- [ ] Mobile dropdown lists Playground / New Metric / Catalog.
- [ ] EN + VN label switching works in both desktop pills and mobile dropdown.
- [ ] No console errors when clicking pills.

## Risk Assessment
- Centering via two `Spacer`s flexes the row toward the geometric middle but offsets if BrandBlock + RightCluster widths differ a lot — accept for now; revisit only if Image #3 fidelity is off by more than ~20 px.
- The Models pill is removed *before* phase 6 lands the `/catalog/models` route — between phase 4 merge and phase 6 merge, `/schema` is the only path to the model browser. Phase 6 adds the `/catalog/models` route and leaves a `/schema` redirect for any deep links.

## Security Considerations
- None.

## Next Steps
- Phase 5 fills in the right cluster (search + help + bell + avatar dropdown).
- Phase 6 nests Models under `/catalog`.
