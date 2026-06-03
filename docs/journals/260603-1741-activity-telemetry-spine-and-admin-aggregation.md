# Activity Telemetry Spine + Admin Aggregation (Phases 3–4)

**Date**: 2026-06-03 17:41
**Severity**: Medium
**Component**: Authorization, Telemetry, Admin Hub
**Status**: Resolved

## What Happened

Shipped activity telemetry infrastructure and admin aggregation backend for workspace isolation feature (RFC: workspace-isolation-and-sysadmin-hub). Two backend phases delivered:

1. **Phase 3 — Activity spine:** Append-only `activity_events` table (sub-keyed primary), fire-and-forget `recordActivity` async handler (runs outside caller txn, warns on disk-full, never throws), PII allowlist projector (extracts cube/measure/dimension names only—never filter values/UIDs), and point emission for query_run / segment_op / feature_open.

2. **Phase 4 — Aggregation + inactive detection:** `activity-aggregator` service (org summary + per-user rows, email→sub resolution via `user_access.kc_sub` before chat fan-out, graceful null-degradation), admin-gated `/api/admin/activity/*` routes (separate Fastify plugin with encapsulated guard chain), 90-day prune job, and activity-emit points for export/workspace_switch.

## The Brutal Truth

This was a grinding 4-hour session threading two distinct identity namespaces that **happen to have the same name** in the codebase: sub ↔ email (auth/grants) vs cube member identity-fields (row selection). The naming collision is not new, but living inside both systems simultaneously made it visceral. A separate identity-map cache fix in the tree collided namespace-wise; I kept it out of the commit to avoid scope creep and double-checking. That's the right call, but it means someone else will bump their head on it later.

The chat-service stats gate is intentionally unconditional (`401` even when `AUTH_DISABLED=true`) — fail-open would leak cross-user telemetry exactly where the SSO wall is already down. That felt paranoid at 1am until I traced the threat model. Correct, but worth a comment flag for future maintainers.

## Technical Details

- PII boundary: allowlist-only extractor (`projectQueryShape`), not denylist. New cube fields cannot leak without deliberate action.
- Chat bridge: `GET /internal/stats` gated by explicit `INTERNAL_SECRET` header. No fallback to disable.
- Test baseline: 4 pre-existing failures in `test/internal-access-route.test.ts` (standalone on clean main) — not introduced.
- Server tsc 0 errors; suite 678 pass / 4 pre-existing. Chat-service 885/885 pass. FE tsc unchanged.

## What We Tried

Initial design had chat stats gate inherit from server's `AUTH_DISABLED` fallback. Code review caught the cross-user leak scenario; reverted to unconditional secret gate with explicit test case.

## Root Cause Analysis

Not a failure — design surface clarified during review. The threat model (leaked telemetry when SSO is offline) was real but implicit. Making it explicit (test + comment) prevents silent assumptions.

## Lessons Learned

1. **Identity namespace collision is a code smell.** The sub ↔ email distinction is real (auth root vs cube row key), but sharing a name in one codebase creates local friction. Worth a future refactor pass to prefix-clarify (e.g., `authz_sub` / `cube_member_id`).
2. **PII boundary as allowlist, not denylist.** Avoids accidentally shipping new fields. Cost: explicit maintenance when cube schema evolves. Worth it.
3. **Unconditional secrets beat fallback gates.** Telemetry is low-integrity data; fail-secure is easier to verify than fail-open paths.

## Next Steps

Phases 1–4 committed (commit 0d06dbf), not pushed. Phases 5–7 (admin hub shell + per-user huashu panel, fine-grained controls, observability dashboard) blocked on full huashu hi-fi prototype (human approval decision). Stop here per user direction.

