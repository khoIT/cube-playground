---
phase: 2
title: Mount in admin hub
status: completed
priority: P1
effort: 3h
dependencies:
  - 1
---

# Phase 2: Mount in admin hub

## Overview

Replace `CrossUserAuditPanel` at `/admin/dev/chat-audit` with the parameterized `DevAuditShell` rooted at `/admin/dev/chat-audit`, **without** the Starters tab. The admin mount always runs `scope=all` (admin-only surface).

## Requirements

- Functional: `/admin/dev/chat-audit` shows Sessions/Search/Leaderboard/Cache (4 tabs, no Starters). Sessions defaults to all-users scope with the owner filter. Deep-links + hash nav work under the `/admin` base. Outer admin hub tab "Dev / Chat-Audit" stays highlighted across all sub-routes.
- Non-functional: no double sticky page-header (admin hub already renders its own page header + tab bar). The shell's internal banner must not visually clash.

## Architecture

`DevHubPanel` route for `/admin/dev/chat-audit` renders `<DevAuditShell basePath="/admin/dev/chat-audit" tabs={ADMIN_AUDIT_TABS} />` instead of `<CrossUserAuditPanel />`. Because `DevHubPanel` already nests a `TabShell` (Chat-Audit / Advisor-Audit / Data coverage), the inner `DevAuditShell` must render its **own** sub-tab bar (Sessions/Search/…) below the DevHubPanel tab row — i.e. a two-level tab nest. Confirm visual hierarchy reads cleanly; if the doubled chrome is noisy, suppress the shell's standalone banner when `basePath !== '/dev/chat-audit'` (admin context) and keep just the audit tab bar.

`ADMIN_AUDIT_TABS` = the 4-tab list minus `starters`, passed into `AuditTabs` via the new `tabs` prop from Phase 1.

Route wiring in `DevHubPanel`:
```tsx
<Route path="/admin/dev/chat-audit">
  <DevAuditShell basePath="/admin/dev/chat-audit" tabs={ADMIN_AUDIT_TABS} />
</Route>
```
`DevAuditShell` builds `<Switch>` routes from its `basePath`, so `/admin/dev/chat-audit/sessions/:id?`, `/search`, `/leaderboard`, `/cache` all resolve. The exact-base redirect goes to `…/sessions`. The legacy `:sessionId` redirect is harmless under admin too (keep it; it only fires on an unmatched single segment).

Scope: `sessions-tab.tsx` already defaults `scope='all'` and gates the radio on `isAdmin`. Admin hub users are admins, so no change needed — the All/Mine toggle + owner filter appear automatically. (Confirm the admin hub user always resolves `role === 'admin'` via `useAuthUser()`; the hub is already behind an admin gate.)

## Related Code Files

- Modify:
  - `src/pages/Admin/hub/dev-hub-panel.tsx` — import `DevAuditShell` + `ADMIN_AUDIT_TABS`; swap the `chat-audit` route's body. Remove `CrossUserAuditPanel` import (file retired in Phase 5, not deleted yet).
  - `src/pages/DevAudit/audit-tabs.tsx` — export `ADMIN_AUDIT_TABS` (or build inline in dev-hub-panel from a shared base-tabs factory). Prefer a single `buildAuditTabs(basePath, { includeStarters })` helper to avoid two drifting arrays.
  - `src/pages/DevAudit/dev-audit-shell.tsx` — optional banner suppression in admin context (only if visually needed).
- Read for context: `src/pages/Admin/hub/index.tsx` (outer tab + `resolveTab`), `src/shell/tab-shell.tsx`.

## Implementation Steps

1. In `audit-tabs.tsx`, replace the static `AUDIT_TABS` with `buildAuditTabs(basePath, { includeStarters = true })`; `AuditTabs` calls it. Export it for the hub.
2. In `dev-hub-panel.tsx`, swap the `/admin/dev/chat-audit` route to mount `DevAuditShell` with `basePath="/admin/dev/chat-audit"` and `tabs={buildAuditTabs('/admin/dev/chat-audit', { includeStarters: false })}`.
3. Verify `DevAuditShell` renders its routes from `basePath` (Phase 1) — sessions/search/leaderboard/cache only; no starters route registered when the tab is absent (registering an unreachable starters route is harmless, but omit it for cleanliness when `includeStarters` is false).
4. Decide banner: render the shell's internal "Chat Audit — internal triage tool" banner only when `basePath === '/dev/chat-audit'`; in admin context the hub header already frames it.
5. Confirm `resolveTab` in the OUTER hub keeps "Dev / Chat-Audit" active for all `/admin/dev/chat-audit/*` (segment-prefix match — already true).
6. `tsc --noEmit` + run hub tests (`src/pages/Admin/hub/__tests__`) + DevAudit tests.

## Success Criteria

- [ ] `/admin/dev/chat-audit` renders the 4-tab shell; no Starters tab.
- [ ] Sessions shows All/Mine + owner filter; defaults to all-users.
- [ ] `/admin/dev/chat-audit/search?q=…&mode=cached`, `…/leaderboard`, `…/cache`, and `…/sessions/:id#turn-…` all resolve and cross-nav within the `/admin` base.
- [ ] Outer "Dev / Chat-Audit" hub tab stays active across all sub-routes.
- [ ] No visual double-header; chrome reads as one coherent surface (cross-check vs Observability sub-tab pattern per design-guidelines).
- [ ] `CrossUserAuditPanel` no longer mounted (still on disk until Phase 5).

## Risk Assessment

- **Risk:** nested `TabShell` (DevHubPanel tabs + audit tabs) produces confusing double tab rows. *Mitigation:* banner suppression + visual cross-check; if still noisy, fold audit tabs to look subordinate (segmented control) — escalate to user only if a design call is needed.
- **Risk:** `/api/chat/debug/*` reachable on prod for the admin identity with `scope=all`. *Verified:* standalone `/dev/chat-audit` already exercises this path for admins; same auth. Note the trade-off vs the stricter `/api/admin/chat/*` JWT+feature guard (accepted per locked decision #1).

## Next Steps

Unblocks Phase 3 (owner email) and Phase 4 (search default) — both layer onto the now-mounted admin shell.
