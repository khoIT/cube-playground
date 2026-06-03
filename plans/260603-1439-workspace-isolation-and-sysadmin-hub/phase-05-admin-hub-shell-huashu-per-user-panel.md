---
phase: 5
title: "Admin Hub Shell & Huashu Per-User Panel"
status: complete
priority: P2
effort: "3-4d"
dependencies: [1]
---

# Phase 5: Admin Hub Shell & Huashu Per-User Panel (Sub-project C, foundation)

## Overview
Turn `/admin/access` into a tabbed sys-admin hub and design the centerpiece — the fine-grained per-user control panel — as a huashu hi-fi prototype first, then port the shell + reskinned existing access UI into React with design tokens. No new backend (consumes the already-shipped grant API).

## Requirements
- Functional:
  - Tabbed hub at `/admin` (or extend `/admin/access`): **Users & Access** (existing, reskinned for fine-grain), **Observability** (placeholder this phase; filled Phase 7), **Dev / Chat-Audit** (move existing dev + chat-audit surfaces in).
  - Huashu prototype of the per-user control panel: role/status, workspace grants (with explicit "can switch workspaces" affordance when >1 granted), game grants with live count, feature toggles grouped by area, and an activity-snapshot slot (wired Phase 6/7).
  - Admin-only route guard (reuse `role==='admin'` FE guard + server `requireRole('admin')+requireFeature('admin')`).
- Non-functional: every shipped pixel uses `tokens.css` per `design-guidelines.md`; reuse existing `GrantMatrix`, `UserList`, `AccessEditor` components — do not fork.

## Architecture
- **huashu-design first (user-confirmed FULL gate):** HTML hi-fi prototype + variants for the per-user panel. Save under `visuals/`. Sign-off BEFORE React port (mirror unified-concept-fabric P1 flow).
- **Tab shell — generalize the EXISTING one, don't author new (red-team H2):** DevAudit already ships a URL-driven, ARIA `role=tablist`, keyboard-nav tab shell (`src/pages/DevAudit/dev-audit-shell.tsx`, `audit-tabs.tsx`). Lift/generalize it for the hub; existing access UI becomes the "Users & Access" tab body. Dev/Chat-Audit relocate as tabs (move, not duplicate).
- **Token-system reconciliation (red-team H2):** DevAudit is built on the legacy `T`/`shell/theme` (`audit-tabs.tsx:11`), NOT `tokens.css`. Folding it into the hub otherwise drags two token systems together — a design-guidelines violation. Add an explicit task to migrate relocated DevAudit surfaces onto `tokens.css`.
- Per-user panel composes existing `GrantMatrix` + `AccessEditor` (role/status) + new "experience summary" header (switch-ability, game count). Reconcile prototype to tokens — never ship raw huashu HTML.
- **Chat-Audit scoping note:** DevAudit is `X-Owner-Id` self-scoped — an admin viewing it sees only their OWN chats. Decide in this phase whether the relocated tab needs cross-user scoping (admin views any user's audit) — if so it's not a pure "move."

## Related Code Files
- Create: `visuals/` huashu prototype (HTML), `src/pages/Admin/hub/` (tab shell + index)
- Modify: `src/pages/Admin/access/*` (lift into Users & Access tab; reskin per prototype), `src/index.tsx` (route → hub), settings-page admin entry
- Relocate + token-migrate (not rewrite logic): `src/pages/DevAudit/*` dev + chat-audit surfaces into hub tabs; migrate `T`/`shell/theme` → `tokens.css`
- Generalize (not author new): `src/pages/DevAudit/dev-audit-shell.tsx`, `audit-tabs.tsx` (existing ARIA tab shell)
- Read: `docs/design-guidelines.md`, `src/theme/tokens.css`, `src/pages/Dashboards/index.tsx` + `src/pages/Liveops/cohort/index.tsx` (header pattern), `plans/260603-0324-unified-concept-fabric/visuals/affordance-decisions.md`

## TDD: Tests First
- FE logic (not pixels): test the tab shell renders the correct tab for role; non-admin redirected; per-user panel maps grant API response → control state (selected workspaces/games/features) correctly. Component/unit tests via existing FE test setup (Vitest).
- Visual fidelity validated via huashu prototype sign-off + design-token cross-check (manual), not automated pixels.

## Implementation Steps
1. huashu hi-fi prototype of per-user panel (+ tab shell layout); save to `visuals/`; **sign-off gate**.
2. Write tab-shell + panel-mapping unit tests (tests-first for the logic).
3. Build tab shell; lift existing access UI into Users & Access tab.
4. Relocate dev + chat-audit into tabs.
5. Reskin per-user panel to prototype using tokens; add experience-summary header (switch-ability, game count) bound to existing grant data.
6. FE suite green; design-guidelines cross-check vs Dashboards/Cohort.

## Success Criteria
- [x] Signed-off huashu prototype in `visuals/`; React port matches + uses only `tokens.css`. — Variant B (two-column) signed off `visuals/sign-off-decisions.md`; `hub/per-user-panel.tsx` ports it on tokens.css.
- [x] `/admin` hub built on the GENERALIZED existing tab shell (not new); Users & Access + Observability(placeholder) + Dev/Chat-Audit tabs; surfaces moved, not duplicated. — `src/shell/tab-shell.tsx` (extracted), `hub/index.tsx`; DevAudit's `audit-tabs.tsx` refactored to a thin adapter over it.
- [x] Relocated DevAudit surfaces migrated off legacy `T` onto `tokens.css` (no two-token-system drift). — hub Dev tab renders a fresh tokens.css `CrossUserAuditPanel`; legacy hermes shell left at its own `/dev/chat-audit` route (not dragged into the hub).
- [x] Chat-Audit tab scoping decided (admin's own vs cross-user) + implemented accordingly. — cross-user (user-confirmed); net-new admin-gated backend `GET /api/admin/chat/*` (sub-isolated) + `CrossUserAuditPanel`.
- [x] Per-user panel renders role/status/workspace/game/feature from existing API; shows switch-ability + game count. — `hub/per-user-panel.tsx` + helpers (`switchability`, `groupFeatures`, game N-of-M, read-only activity snapshot).
- [x] Admin-only guard intact; FE tests green; visual parity with adjacent pages. — non-exact `/admin` behind `AdminHubRoute`; FE 1592/1592, hub+shell 52/52; server 705 (4 pre-existing unrelated).

## Completion Notes (2026-06-03)
- huashu FULL gate honored: interactive 3-variant prototype (`visuals/index.html`) + screenshots; user signed off Variant B two-column + cross-user audit scope before any React work.
- Generalized the DevAudit ARIA tab shell into `src/shell/tab-shell.tsx` (`TabShell` + pure `resolveTab` with exact-or-segment-boundary match, longest-match-wins). `audit-tabs.tsx` reduced 150→~50 lines as a thin adapter; tab IDs unchanged (backward compat). DevAudit at `/dev/chat-audit` still works.
- Cross-user scope (scope expansion, user-confirmed): net-new `admin-chat-audit.ts` re-declares its own `requireRole('admin')+requireFeature('admin')` (Fastify encapsulation), resolves target email→kcSub via `getAccess`, proxies to chat-service with the TARGET user's sub. 19 route tests (400/404/502/status-forward). Decided NOT to retrofit the 34-file self-scoped DevAudit — a fresh tokens.css panel delivers cross-user AND dissolves the two-token-drift concern for the hub.
- Code review: one Critical (FE used bare `fetch()` → 401 in prod real-auth) caught + fixed (routed through `apiFetch`); M1 `resolveTab` substring mis-route fixed (segment-boundary); M2 plan/phase refs scrubbed from code/comments. All verified by grep, not narration. Report: `plans/reports/code-reviewer-260603-1825-sysadmin-hub-phase5-prod-readiness-review-report.md`.
- Stable-reason rule honored: 0 phase/variant/finding refs in shipped code, comments, filenames, or user-visible strings.

## Risk Assessment
- **Risk:** raw huashu HTML drifts from design system. **Mitigation:** prototype = artifact only; mandatory token reconcile + adjacency cross-check.
- **Risk:** duplicating dev/chat-audit instead of moving. **Mitigation:** relocate components; no second copy.
- **Risk:** overlap with querybuilder-right-pane-redesign FE work. **Mitigation:** scope to Admin surface; verify no shared component edits.
