# Sys-Admin Hub Shell & Cross-User Per-User Panel

**Date:** 2026-06-03
**Plan:** `plans/260603-1439-workspace-isolation-and-sysadmin-hub/` — Phase 5
**Commit:** `85ece46`

## What shipped

`/admin` is now a tabbed sys-admin hub (Users & Access · Observability · Dev/Chat-Audit)
built on a reusable tab shell, centered on a two-column fine-grained per-user control
panel. Cross-user chat audit got a net-new admin-gated backend.

## Decisions that mattered

- **huashu FULL gate honored.** Built an interactive 3-variant HTML prototype + screenshots
  and got explicit sign-off (Variant B two-column + cross-user audit scope) BEFORE any React.
  The gate paid off — the layout choice was the user's, not inferred.
- **Generalize, don't re-author.** The DevAudit ARIA tablist already solved keyboard nav +
  URL-driven selection. Extracted it to `src/shell/tab-shell.tsx` (`TabShell` + pure
  `resolveTab`); `audit-tabs.tsx` shrank 150→~50 lines as a thin adapter, tab IDs unchanged.
- **Cross-user via a fresh panel, not a retrofit.** The self-scoped DevAudit is 34 files on the
  legacy hermes `T` token system. Rather than thread cross-user scoping through all of it (and
  drag two token systems into the hub), built a fresh tokens.css `CrossUserAuditPanel` + a
  net-new `admin-chat-audit.ts` that resolves target email→kcSub and proxies chat-service with
  the TARGET user's sub. This delivered cross-user AND dissolved the two-token-drift concern in
  one move. Legacy shell stays untouched at `/dev/chat-audit`.

## What bit / what to watch

- **Bare `fetch()` → 401 in prod.** Code review's one Critical: the FE panel used `fetch()`,
  which has no Bearer JWT under real-auth and 401s in prod (works only in `AUTH_DISABLED` dev).
  Fix: route everything through `apiFetch`. Lesson reinforced — any new admin FE surface MUST use
  `apiFetch`, never bare `fetch`. (Logged the verify-by-grep discipline: the fix agent claimed it
  was "already in place"; reviewer said otherwise; grep settled it.)
- **`resolveTab` substring trap.** Naive `startsWith` made `/admin/access-foo` match `access`.
  Fixed to exact-or-segment-boundary (`=== tab.path || startsWith(tab.path + '/')`), longest-match-wins.
- **Fastify encapsulation.** `admin-chat-audit.ts` does NOT inherit `admin-access`'s scoped
  preHandlers — it re-declares its own `requireRole('admin')+requireFeature('admin')`. Same trap
  Phase 4 hit; now a known pattern for any admin route in a separate plugin.

## Verification

FE 1592/1592 (hub+shell 52/52), server 705 (4 pre-existing `internal-access-route` fails,
unrelated), FE tsc steady at 72 pre-existing errors (0 new). All 3 code-review findings fixed
and grep-verified.

## Unresolved

- Observability tab is a placeholder; it renders the Phase-4 activity aggregator in Phase 7.
- Per-user panel's activity snapshot is read-only this phase; mutations land in Phase 6.
