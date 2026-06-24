---
phase: 3
title: Owner email resolution
status: completed
priority: P2
effort: 2h
dependencies:
  - 2
---

# Phase 3: Owner email resolution

## Overview

In the Sessions tab owner filter, the owner currently displays as `label || ownerId` — and `owner_id` is a Keycloak `sub` (UUID), `label` is usually null. Resolve each owner to its **email** by joining the `sub` against `useAdminUsers()` (which carries `{ email, kcSub }`). Show email in the dropdown options and in the session rows where the owner is shown.

## Requirements

- Functional: owner filter dropdown options read as `email (count)`; fall back to `label`, then `ownerId` when no email match. Selecting an option still filters by `ownerId` (the value the server understands).
- Non-functional: enrichment is **admin-context only** (the admin users list is admin-gated). The standalone `/dev/chat-audit` keeps `label || ownerId` — it has no admin users list and may be viewed by non-admins.

## Architecture

- The sub→email map is built from `useAdminUsers()`: `Map(kcSub → email)` for all users with a non-null `kcSub`. `AdminUser` confirmed at `src/pages/Admin/access/use-admin-access.ts:13-17`.
- A small resolver hook/util `resolveOwnerLabel(ownerId, label, subToEmail)` returns the best display string: `subToEmail.get(ownerId) ?? label ?? ownerId`.
- Inject the map into `SessionsTab` only in admin context. Cleanest: a context value or an optional prop `ownerEmailResolver?: (ownerId, label) => string` passed from the admin mount. The standalone mount passes nothing → keeps current behavior.
  - Implementation choice: add an optional prop `resolveOwner?: (o: { ownerId: string; label: string|null }) => string` to `SessionsTab`. `DevAuditShell` accepts and threads it; admin mount supplies one built from `useAdminUsers()`. This keeps `DevAudit` free of an `Admin/` import (avoids a layering cycle) — the resolver is constructed in `Admin/hub` and passed down.

## Related Code Files

- Modify:
  - `src/pages/DevAudit/sessions-tab.tsx` — accept optional `resolveOwner`; use it when rendering `<option>` and the selected-owner display. Default = `(o) => o.label || o.ownerId`.
  - `src/pages/DevAudit/dev-audit-shell.tsx` — thread an optional `resolveOwner` prop down to `SessionsTab`.
  - `src/pages/Admin/hub/dev-hub-panel.tsx` (or a thin wrapper) — build `resolveOwner` from `useAdminUsers()` and pass to `DevAuditShell`.
- Create (optional): `src/pages/Admin/hub/use-owner-email-resolver.ts` — `useAdminUsers()` → `(o) => emailBySub.get(o.ownerId) ?? o.label ?? o.ownerId`.
- Read: `src/pages/Admin/access/use-admin-access.ts` (AdminUser shape, kcSub).

## Implementation Steps

1. Add `use-owner-email-resolver.ts` returning a stable `resolveOwner` callback from `useAdminUsers()` (memoized on the users list).
2. In `dev-hub-panel.tsx`, call the hook and pass `resolveOwner` into the admin `DevAuditShell`.
3. Thread `resolveOwner` through `DevAuditShell` → `SessionsTab` (optional prop, default keeps `label || ownerId`).
4. In `SessionsTab`, render `resolveOwner(o)` in each `<option>` and anywhere the active owner is labeled.
5. Edge cases: synthetic/verifier owners (e.g. `VERIFIER_OWNER_ID`) and subs with no admin-user row → fall through to `label ?? ownerId`; never render an empty string.
6. `tsc --noEmit` + tests.

## Success Criteria

- [ ] In `/admin/dev/chat-audit/sessions`, owner dropdown options show emails for known users; unknown subs fall back to label/ownerId.
- [ ] Selecting an email still filters sessions correctly (value stays `ownerId`).
- [ ] Standalone `/dev/chat-audit` owner dropdown unchanged (`label || ownerId`).
- [ ] No `Admin/` import added inside `src/pages/DevAudit/*` (no layering cycle).

## Risk Assessment

- **Risk:** large user list × owners list = O(n·m). *Mitigation:* build a `Map` once (O(n)), lookups O(1).
- **Risk:** `kcSub` null for some users → those won't resolve. *Acceptable:* falls back to label/ownerId; not all users have logged in via Keycloak.

## Next Steps

Independent of Phase 4. Both verified in Phase 5.
