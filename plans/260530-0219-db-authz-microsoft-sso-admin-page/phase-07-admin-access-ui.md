---
phase: 7
title: "Admin Access UI"
status: pending
priority: P2
effort: "2d"
dependencies: [6]
---

# Phase 7: Admin Access UI

## Overview
Admin-only page to manage who can access what: a user list (active + pending queue) and a per-user access editor toggling role, status, and workspace/game/feature grants. Must look native to the existing design system.

## Requirements
- Functional: list/search users; approve pending users; pre-provision by email; toggle role/status and per-dimension grants; reflect server state and show save/error.
- Non-functional: admin-only route (hidden + guarded); design-guidelines compliant; optimistic-but-verified writes; no raw hex/fonts.

## Architecture
- New route `/admin/access` mounted only when the user's feature map / role includes `admin` (enforced in Phase 4; UI also hides the nav entry).
- Layout: master-detail — left = user list (email, role chip, status badge, pending filter); right = access editor (role select, status toggle, three grant groups: Workspaces / Games / Features as checkbox/toggle matrices sourced from `GET /api/admin/registry`).
- Data: thin client over Phase 6 endpoints. Pending queue = filter `status='pending'`. Save → PATCH/PUT → refetch row.
- **Design system (MANDATORY):** read `docs/design-guidelines.md` first. Use `var(--*)` tokens only; one font `var(--font-sans)`; the fixed page-header pattern (24px/32px padding, icon + 20px/700 title, centered maxWidth); semantic status tokens (`--success-soft/-ink` for active, `--warning-soft/-ink` for pending, `--destructive-soft/-ink` for disabled). Cross-check against `src/pages/Dashboards/index.tsx` and the Liveops cohort grid before shipping.

## Related Code Files
- Create: `src/pages/Admin/access/index.tsx` (page), `src/pages/Admin/access/user-list.tsx`, `src/pages/Admin/access/access-editor.tsx`, `src/pages/Admin/access/use-admin-access.ts` (data hooks). Keep each file <200 LOC (modularize per repo rules).
- Modify: route registry (`src/index.tsx`) — guarded `/admin/access`; sidebar nav (`src/shell/sidebar/*`) — admin-only entry.
- Reference: `src/pages/Dashboards/index.tsx` (header pattern), `src/pages/Liveops/cohort/index.tsx` (grid), `src/shell/theme` tokens, `docs/design-guidelines.md`.

## Implementation Steps
1. Read `docs/design-guidelines.md`; pull up Dashboards page as the visual template.
2. `use-admin-access.ts` hooks over Phase 6 endpoints (list, registry, mutators).
3. `user-list.tsx` with search + pending filter + status/role chips (semantic tokens).
4. `access-editor.tsx` — role select, status toggle, Workspaces/Games/Features matrices; save + error states.
5. Guarded route + admin-only nav entry.
6. Cross-check typography/padding/radius/color against an adjacent page; fix drift.

## Todo List
- [ ] read design-guidelines + pick template page
- [ ] admin-access data hooks
- [ ] user list (search, pending filter, chips)
- [ ] access editor (role/status + 3 grant matrices, save/error)
- [ ] guarded route + admin-only nav entry
- [ ] design cross-check vs Dashboards/Cohort

## Success Criteria
- [ ] Admin can approve a pending user and toggle their workspace/game/feature grants; changes persist and take effect next request.
- [ ] Non-admin cannot see or reach the page.
- [ ] Page passes design cross-check (tokens, font, header pattern) vs adjacent pages.

## Risk Assessment
- **Design drift** (the repo's recurring lesson). Mitigation: copy the closest well-formed page; mandatory cross-check step; use tokens only.
- **Stale UI vs server** after edits. Mitigation: refetch the edited row on save; surface server errors, don't fake success.

## Security Considerations
- UI guard is convenience only; real enforcement is the Phase 6 `requireRole('admin')` API gate — never trust the hidden nav.
