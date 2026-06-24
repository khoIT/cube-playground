---
phase: 5
title: Parity verify & cleanup
status: in-progress
priority: P2
effort: 2h
dependencies:
  - 3
  - 4
---

# Phase 5: Parity verify & cleanup

## Overview

Verify every feature of the standalone tool is correctly present in the admin port (the user's explicit ask #4), retire the dead `CrossUserAuditPanel`, and update tests/docs. `/dev/chat-audit` stays live (locked decision #3) — deletion is deferred.

## Requirements

- Functional: a parity checklist proves Sessions, Search, Leaderboard, Cache work identically under `/admin/dev/chat-audit` (Starters intentionally absent).
- Non-functional: no dead imports; tests green; theme-lint clean; docs note the relocation.

## Parity Checklist (admin surface)

Walk each on `/admin/dev/chat-audit` and confirm vs `/dev/chat-audit`:
- [ ] **Sessions** — list loads (scope=all), All/Mine toggle, owner filter shows **emails** (Phase 3), session detail drill-in, turn expand (LLM calls, tool invocations, permission decisions, raw events, annotations), soft-delete restore/purge, inline turn-search swaps list→results.
- [ ] **Search** — 3 modes; **default top-10** per mode on empty input (Phase 4); typing filters; mode chips + keyboard; click navigates (turns→`#turn-`, sessions→detail, cached→original turn).
- [ ] **Leaderboard** — window 7/30/90, game scope, skill row → sessions cross-nav lands under `/admin/...`, sparklines.
- [ ] **Cache** — days/topN filters, hero stats, clear-cache, sortable top-queries, stale banner, row → original turn under `/admin/...`.
- [ ] **Cross-cutting** — deep-link + browser back, hash anchors, no broken `/dev/chat-audit` links leaking from the admin mount, outer hub tab stays active.

## Related Code Files

- Delete (now safe — no longer mounted): `src/pages/Admin/hub/cross-user-audit-panel.tsx` and, if unused elsewhere, `src/pages/Admin/hub/cross-user-audit-data.ts`. Grep first: `grep -rn "cross-user-audit" src`.
  - **Note:** the server routes `server/src/routes/admin-chat-audit.ts` (`/api/admin/chat/*`) become unused by the FE after this. Leave them in place this plan (no FE caller ≠ delete server route); flag as a follow-up cleanup so we don't widen blast radius here.
- Modify: tests that referenced `CrossUserAuditPanel`; add an admin-mount smoke test (renders 4 tabs, no Starters, basePath routes resolve).
- Docs: `docs/codebase-summary.md` / `docs/service-api-surface-map.md` — note chat-audit now lives in the admin hub; `/dev/chat-audit` retained as self-scoped.

## Implementation Steps

1. Run the parity checklist manually (dev server) on both surfaces side by side.
2. `grep -rn "cross-user-audit" src` → remove the now-dead panel + data module if no other importer; drop the stale import in `dev-hub-panel.tsx`.
3. Update/replace hub tests; add admin-mount smoke test.
4. Full gates: `tsc --noEmit`, `npx vitest run src/pages/DevAudit src/pages/Admin/hub src/shell`, `npm run lint` (theme tokens), and chat-service tests for the search change.
5. Update docs; add a `docs/lessons-learned.md` entry only if a non-obvious bug shape surfaced (e.g. base-path leak, nested-TabShell chrome).
6. Confirm `/dev/chat-audit` still fully works (regression).

## Success Criteria

- [ ] Parity checklist fully ticked; Starters confirmed absent by design.
- [ ] `CrossUserAuditPanel` removed; no dangling imports; `grep` clean.
- [ ] All test suites green; theme-lint clean; `tsc --noEmit` clean.
- [ ] `/dev/chat-audit` unchanged (regression verified).
- [ ] Docs updated; follow-up noted to (a) delete `/dev/chat-audit` later and (b) prune unused `/api/admin/chat/*` routes.

## Risk Assessment

- **Risk:** deleting `cross-user-audit-data.ts` breaks an unrelated importer. *Mitigation:* grep gate before delete.
- **Risk:** removing FE callers of `/api/admin/chat/*` silently leaves dead server code. *Mitigation:* explicitly tracked as a follow-up, not silently dropped.

## Open Questions

- Should the unused `/api/admin/chat/*` routes be removed now or in the later `/dev/chat-audit` retirement? (Plan defers — confirm during review.)
