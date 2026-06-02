# Phase 08 — Business-Metric Audit Trail

## Context Links

- SDK review §3.#7 — structured audit trail for business-metric changes
- `server/src/routes/business-metrics.ts` (POST + PATCH /trust routes — no audit today)
- `chat-service/src/tools/update-business-metric-trust.ts` — agent mutator with no audit
- `server/src/presets/business-metrics/*.yml` — source of truth for shipped metrics

## Overview

- **Priority:** P3 — independent of context revamp; compliance/safety win
- **Status:** **Backend done** — migration 016, audit store, POST/PATCH instrumented, GET /history route, `get_business_metric_history` chat tool, 10 server tests. **FE History tab deferred** to a follow-up sub-phase (touches `src/pages/Catalog/`; out of scope for the chat-service revamp window).
- **Description:** Today the agent can flip business-metric trust tiers with no record of who/why/when. Add an append-only `business_metric_audit` table, write to it on every mutation, expose history via new tool `get_business_metric_history`.

## Key Insights

- Mutation surface is small (POST upsert, PATCH trust). One write-through helper covers both.
- Audit is append-only — no UPDATE/DELETE — to preserve integrity.
- Backfill is a separate decision (see open question in plan.md).

## Requirements

**Functional**
- New table `business_metric_audit (id, ts, metric_id, action, old_value_json, new_value_json, actor_kind, actor_id, reason, request_id)`.
- `action` ∈ `'create' | 'update' | 'trust_change' | 'delete'`.
- `actor_kind` ∈ `'user' | 'agent' | 'system'`.
- Both routes (POST + PATCH /trust) call a single `auditMetricChange(...)` helper inside the same transaction as the mutation.
- Agent tool `update_business_metric_trust` accepts optional `reason` parameter; passed through to audit row.
- New read-only tool `get_business_metric_history({ id, limit?, since? })` returns audit rows for the metric.
- New read-only API `GET /api/business-metrics/:id/history` for the UI to render a "History" tab.

**Non-functional**
- Audit write must not double turn latency — measure baseline + post-implementation.
- Append-only enforced at app layer; no DB triggers needed for SQLite.
- Audit rows never deleted in normal operation; archival is a future concern.

## Architecture

```
Route handler
  └─ db.transaction(() => {
       mutate_metric(...)
       auditMetricChange({ metric_id, action, old, new, actor, reason })
     })

Agent
  update_business_metric_trust({ id, trust, reason })
    └─ same path; actor_kind='agent', actor_id=ownerId

Read
  get_business_metric_history → /api/business-metrics/:id/history
  History tab in Catalog / metric detail page
```

## Related Code Files

**Modify**
- `server/src/routes/business-metrics.ts` (call audit helper inside transaction)
- `chat-service/src/tools/update-business-metric-trust.ts` (accept + forward `reason`)
- `chat-service/src/tools/registry.ts` (register new tool)
- FE: `src/pages/Catalog/...` metric detail (add History tab)

**Create**
- `server/src/db/business-metric-audit-store.ts`
- `server/src/db/business-metric-audit-migrate.ts`
- `chat-service/src/tools/get-business-metric-history.ts`
- `server/src/routes/business-metric-history.ts`
- `server/src/__tests__/business-metric-audit.test.ts`
- `src/pages/Catalog/business-metric-history-tab.tsx`

## Implementation Steps

1. Migration: add `business_metric_audit` table; index on `(metric_id, ts DESC)`.
2. `business-metric-audit-store.ts`: `insertAuditRow()`, `listAudit(metricId, opts)`.
3. Wrap existing POST handler:
   - Compute `old = current row || null`, run mutation, then `insertAuditRow(...)` inside same transaction.
4. Wrap PATCH /trust similarly; `action='trust_change'`, diff captures `old_trust` → `new_trust`.
5. Add `reason` parameter to agent tool input schema (string, optional, max 500 chars); pass through.
6. New read route `GET /api/business-metrics/:id/history` (paginated, default limit 50).
7. New agent tool `get_business_metric_history` (wrap the read route).
8. FE History tab on metric detail page; reuse existing list/table primitives + design tokens.
9. Tests:
   - Mutation → audit row appears in same txn.
   - Failed mutation → no audit row (rollback).
   - History endpoint pagination + ordering.
10. Backfill decision (separate doc): start fresh by default; document option to mine git history of YAML presets as a one-time job.

## Todo List

- [x] Migration `016-business-metric-audit.sql` + `business-metric-audit-store.ts`
- [x] POST `/api/business-metrics` writes a 'create' or 'update' audit row on success
- [x] PATCH `/api/business-metrics/:id/trust` writes a 'trust_change' audit row with old/new trust
- [x] `update_business_metric_trust` already accepts `note` (mapped to `reason` in audit)
- [x] `get_business_metric_history` chat-service tool (registered + added to explore + diagnose allowed_tools)
- [x] `GET /api/business-metrics/:id/history` route (paginated, default 50, max 500)
- [x] History tab UI — replaces the `tab-activity` placeholder on the metric detail page. New `useBusinessMetricHistory` hook (`src/pages/Catalog/metric-detail/use-business-metric-history.ts`) calls `GET /api/business-metrics/:id/history`; UI renders a row per entry with action pill (create/update/trust_change/delete) + actor + reason summary (falls back to `old → new` for trust changes); 4 tests in `tab-activity.test.tsx`
- [x] Tests: 10 server tests covering store CRUD, POST/PATCH instrumentation, /history shape
- [ ] Backfill decision doc — deferred; start fresh per phase plan default

## Success Criteria

- 100% of business-metric mutations (POST + PATCH /trust) produce an audit row.
- Failed mutations produce zero audit rows (transactional integrity).
- History tab visible on every metric detail page; loads <500ms.
- Agent tool returns history with stable ordering.
- Latency overhead per mutation <10ms.

## Risk Assessment

- **R1 Transactional boundary mismatch** — easy to write audit outside the txn. Code review checklist + test that asserts rollback.
- **R2 Reason field abuse** — agent could fabricate reasons. Mitigation: store `actor_kind='agent'` clearly; UI labels agent-authored reasons distinctly.
- **R3 Storage growth** — audit rows accumulate. Estimate ~100 mutations/day = ~36k rows/year; trivial for SQLite. Revisit after 12 months.

## Security Considerations

- Audit table never exposed for write via API.
- `reason` field sanitised (strip control chars, length-bound).
- History endpoint requires same auth as metric read.

## Next Steps

- Phase 03 memory panel could surface "agent recently changed: trust on X" as a notification.
- Future: extend audit pattern to segments, dashboards.
