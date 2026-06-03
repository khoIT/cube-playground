# Per-User Controls & Observability Dashboard

**Date:** 2026-06-03
**Plan:** `plans/260603-1439-workspace-isolation-and-sysadmin-hub/` — Phases 6 & 7 (plan complete)
**Commits:** `82fc322` (controls), `b9cea1d` (observability + docs)

## What shipped

Closed out the sys-admin hub: fine-grained per-user grant controls (Phase 6)
and the Observability tab + audit-log viewer (Phase 7). The whole 7-phase plan
is now complete.

## Decisions that mattered

- **Phase 6 was an enhancement, not a rebuild.** Phase 5's panel already saved
  role/status/workspace/game/feature grants and showed switch-ability + game
  count + override badges. The genuinely net-new work was small: bulk
  select-all/clear, optimistic rollback on save error, and "last changed by/at".
  Resisted the plan's literal call for a new `derive-user-experience.ts` selector
  — the Phase-5 helpers already held that pure logic; a duplicate would violate
  DRY. Documented the consolidation instead of cargo-culting the filename.
- **One audit read layer, two consumers.** `queryAccessAudit` + `latestAuditForTarget`
  serve both Phase 6's "last changed" line and Phase 7's audit-log viewer. Built
  it once in Phase 6 because that phase needed `latestAuditForTarget` first.
- **Recent-activity feed = the audit-log viewer.** No second feed surface — the
  filtered newest-first audit table is the feed. KISS.

## What bit / what to watch

- **The docs-manager agent hallucinated specifics.** It confidently wrote
  migration `030` (real one is `028`), called `INACTIVE_DAYS` and
  `ACTIVITY_RETENTION_DAYS` "env-tunable" (both are code constants — the plan
  explicitly kept them constants, YAGNI), fabricated a "server 1098 tests" count
  (actual suite is 718), and invented a phase numbering that didn't match the
  plan. Caught all of it by grepping source before committing. **Lesson:**
  treat agent-written docs like agent-written code — verify every concrete
  number/identifier against source; narrative confidence is not evidence.
- **apiFetch, again.** Every new admin FE read (`useActivitySummary`, `useAuditLog`)
  goes through `apiFetch`, never bare `fetch` — admin routes 401 without the
  Bearer JWT in prod real-auth. This is now the third surface where that mattered;
  it's a reflex worth keeping.

## Verification

server 718/718, FE 1618/1618 (+26 over the session start), FE tsc steady at 72
pre-existing (0 new), server tsc 0. The previously-flaky `internal-access-route`
tests passed cleanly this run.

## Unresolved

- `INACTIVE_DAYS` / `ACTIVITY_RETENTION_DAYS` are constants by design (YAGNI). If
  ops ever needs to tune them without a deploy, promote to env — not before.
