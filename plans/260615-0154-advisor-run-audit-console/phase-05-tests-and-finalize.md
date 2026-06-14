# Phase 05 — Tests sweep + finalize

## Overview
- **Priority:** P1. **Status:** ✅ Done. **Depends on:** 01–04
- Consolidate test coverage, run the full suite, then finalize (project-mgmt sync-back, docs, journal, optional commit).

## Test matrix
| Layer | Test | File |
|---|---|---|
| Store | round-trip run/turn/tool_call/event; prune cascade; PII-free | `server/test/advisor-run-store.test.ts` |
| No-PII | new agent-dir files clean | existing `advisor-agent-no-pii-surface.test.ts` (auto-scans) — verify green |
| Recorder/runtime | stub-SDK turn → recorder gets run+turn+tool_calls+events; timeout records failed cube_query w/ duration+error; recorder throw ≠ turn break | `server/test/advisor-run-recorder.test.ts` |
| Routes | 403 non-admin; list/filter/detail/events shapes | `server/test/admin-advisor-audit-route.test.ts` |
| UI | failure-hint mapping pure fn; panel list→detail smoke (pageerror==0) | `src/pages/Admin/hub/__tests__/advisor-failure-hints.test.ts` (+ optional panel test) |

- No fabricated data; use `:memory:` DB via `setDb` for store/route tests (existing pattern).
- Honor no-stash rule with concurrent sessions; verify any pre-existing failure via `git show` before attributing.

## Finalize (MANDATORY)
1. `/ck:project-management` — sync-back all phase files + `plan.md` status/progress.
2. `docs-manager` — update `docs/system-architecture.md` (advisor audit persistence layer + tables), `docs/codebase-summary.md` (new store/recorder/route/panel files), `docs/service-api-surface-map.md` (`/api/admin/advisor/runs*`), `docs/project-changelog.md`, `docs/lessons-learned.md` (any bug-shape).
3. Memory: record durable fact — advisor runs now persisted to `segments.db` (tables + retention) with an admin audit console; file refs.
4. Ask user re: commit via `git-manager`.
5. `/ck:journal`.

## Todo
- [ ] store tests
- [ ] recorder/runtime tests
- [ ] route tests
- [ ] UI hint + smoke tests
- [ ] full server suite green (no fabricated data)
- [ ] project-mgmt sync-back
- [ ] docs sync
- [ ] memory entry
- [ ] commit (ask) + journal

## Success criteria
- All suites green incl. no-PII guard; route gating proven; timeout-run trace asserted end-to-end.
- Docs + memory record the new persistence layer and console.
