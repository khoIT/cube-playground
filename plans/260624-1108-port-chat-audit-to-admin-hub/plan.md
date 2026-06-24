---
title: Port full chat-audit tool into admin hub
description: >-
  Port the 5-tab DevAuditShell (Sessions/Search/Leaderboard/Cache, drop
  Starters) into /admin/dev/chat-audit, replacing the thin CrossUserAuditPanel.
  Add owner→email resolution + search default top-10.
status: in-progress
priority: P2
branch: main
tags:
  - admin
  - chat-audit
  - observability
blockedBy: []
blocks: []
created: '2026-06-24T04:57:25.759Z'
createdBy: 'ck:plan'
source: skill
---

# Port full chat-audit tool into admin hub

## Overview

`/admin/dev/chat-audit` today hosts `CrossUserAuditPanel` — a thin user-picker → sessions → detail view (3 admin routes, no Search/Leaderboard/Cache/Starters). The full tool already exists as the standalone `DevAuditShell` at `/dev/chat-audit/*` (5 tabs). This plan **ports the full shell into the admin hub** by decoupling its hardcoded base path, then adds the two requested UX upgrades.

**Locked decisions** (confirmed with user 2026-06-24):
1. **Data path** = reuse `/api/chat/debug/*` with `scope=all` (already admin-gated). No `/api/admin/chat/*` proxies for the new tabs. Owner→email resolved **client-side** via `useAdminUsers()` `kcSub` join — zero server change for ask #1.
2. **Drop Starters** from the admin port. It's a global (non-per-user), dev-local QA viewer for pregenerated starter prompts; doesn't fit a cross-user admin audit surface. Stays only on `/dev/chat-audit`.
3. **Keep `/dev/chat-audit` as-is** (self-scoped; non-admins audit only their own chats). Replace only `CrossUserAuditPanel`. Retire it after parity is confirmed (deferred — not this plan).

**Key verified facts** (drive the work):
- `owner_id` = Keycloak `sub` (UUID); `session-owners.label` = `MAX(owner_label)` from `chat_sessions`, ad-hoc and usually null (`chat-service/src/db/observability-store.ts:340`). No sub→email index server-side.
- `AdminUser` carries `{ email, kcSub }` (`src/pages/Admin/access/use-admin-access.ts:13-17`) → client-side sub→email join.
- Empty-`q` defaults: `/debug/sessions` returns recent-N (works); `searchCachedQueries` returns top by `hit_count DESC` with empty filter (`response-cache-store.ts:178`, works); `/debug/search` **hard-returns `[]`** on empty `q` (`debug-search.ts:33-55`) → the ONE server tweak.
- All hardcoded `/dev/chat-audit/...` paths: `dev-audit-shell.tsx`, `audit-tabs.tsx`, `sessions-tab.tsx`, `search-tab.tsx`, `skill-leaderboard-page.tsx`, and the cross-nav in `search-result-list`/`search-results-*`/`cache-dashboard-top-queries`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Decouple base path](./phase-01-decouple-base-path.md) | Completed |
| 2 | [Mount in admin hub](./phase-02-mount-in-admin-hub.md) | Completed |
| 3 | [Owner email resolution](./phase-03-owner-email-resolution.md) | Completed |
| 4 | [Search default top-10](./phase-04-search-default-top-10.md) | Completed |
| 5 | [Parity verify & cleanup](./phase-05-parity-verify-cleanup.md) | In Progress |
| 6 | [Hide bot/test/eval sessions](./phase-06-hide-synthetic-sessions.md) | Completed |

## Dependencies

- Phases are sequential. P1 (decouple) is a regression-safe refactor that unblocks P2. P3 and P4 are independent feature adds that can run in either order after P2. P5 verifies the whole. P6 (added mid-implementation on user request) layers onto the mounted Sessions tab.
- No cross-plan dependencies. Adjacent: `260624-1038-admin-observability-user-switch-flow` (same admin hub shell, different tab) — no file overlap.

## Status notes

- **P5 partially done:** code-level parity verified (all 4 tabs basePath-threaded, leaf nav via `auditPath`), all gates green (361 FE + 23 BE tests, theme-lint, tsc). **Deferred pending user sign-off:** (a) live browser parity walk-through on both surfaces; (b) physical deletion of `cross-user-audit-panel.tsx` + `cross-user-audit-data.ts` + their test (now unmounted, harmless on disk) — held back per user guardrail "delete later after ensuring everything works".
- **Follow-ups:** delete `/dev/chat-audit` route later; prune unused `/api/admin/chat/*` server routes (no FE caller after this port).
