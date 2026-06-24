---
phase: 6
title: "Hide bot/test/eval sessions"
status: completed
priority: P2
effort: "2h"
dependencies: [2]
---

# Phase 6: Hide bot/test/eval sessions

## Overview

Added on user request mid-implementation: a Sessions-tab toggle to easily filter
out synthetic (eval / test / bot) chat sessions so admins audit real user chats
first. Hidden by default (user choice), with a "Hide bot/test" checkbox to reveal.

## Requirements

- Functional: in the admin all-users audit, a "Hide bot/test" checkbox (default
  ON) excludes synthetic sessions from both the session list and the owner-filter
  dropdown + counts. Unchecking reveals them. An explicit owner pin overrides the
  filter (a pinned synthetic owner still shows).
- Non-functional: confined to the admin all-users audit surface (`scope=all`).
  Self-scoped `mine` / standalone `/dev/chat-audit` views are unaffected — the
  shared verifier sessions stay visible there as before.

## Architecture

No `kind`/`source` column exists on `chat_sessions`. Synthetic owners use
human-readable slugs (`starter-question-verifier`, `aqeval-*`, `prof-hit-*`,
`verify-*`, probes), while real owners are a Keycloak `sub` (UUID) or — in
AUTH_DISABLED dev — an email. So the filter keys off owner_id shape:

- `HUMAN_OWNER_SQL` (in `observability-store.ts`): `(owner_id LIKE '%@%' OR
  owner_id GLOB '[hex]{8}-*')` — TRUE for human owners. Static fragment, no
  interpolation. Auto-covers new eval/probe owners without a brittle prefix list.
- Applied in `listSessionsForDebug` (skipped when an owner is pinned — pin wins)
  and `listSessionOwnersForDebug` (so the dropdown matches).
- Routes `/debug/sessions` + `/debug/session-owners` take a `hideSynthetic` query
  param; admin-gated server-side (a self-scoped owner_id is always human anyway).
- Client: `useDebugSessions` + `useDebugSessionOwners` pass `hideSynthetic`;
  `SessionsTab` owns the toggle state (`effectiveHideSynthetic = ownersEnabled &&
  hideSynthetic`) and threads it to `SessionList` + the owners hook.

## Related Code Files

- Modify (server): `chat-service/src/db/observability-store.ts` (HUMAN_OWNER_SQL +
  `hideSynthetic` on both list fns), `chat-service/src/api/debug.ts` (param wiring,
  admin-gated).
- Modify (client): `src/pages/DevAudit/sessions-tab.tsx` (toggle UI + state),
  `src/pages/DevAudit/session-list.tsx` (prop), `src/pages/DevAudit/use-debug-api.ts`
  (both hooks).
- Tests: `chat-service/test/debug-admin-audit-scope.test.ts` (+4 hideSynthetic cases).

## Success Criteria

- [x] Admin all-users audit hides synthetic sessions by default; checkbox reveals.
- [x] Owner dropdown + counts match the filtered list.
- [x] Explicit owner pin overrides the filter (server-side, `!filterOwnerId`).
- [x] Self-scoped / standalone views unaffected (verifier sessions still visible).
- [x] Backend tests green; FE + BE tsc clean; theme-lint clean.

## Risk Assessment

- **Risk:** heuristic misclassifies a real non-UUID, non-email owner as synthetic.
  *Mitigation:* verified all human owner_ids in this codebase are UUID (Keycloak
  sub) or email (dev bootstrap). Toggle lets an admin reveal everything if needed.

## Next Steps

None — feature complete and verified.
