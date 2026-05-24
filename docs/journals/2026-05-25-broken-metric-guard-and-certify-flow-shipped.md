# Broken-Metric Guard + Certify Flow Shipped

**Date**: 2026-05-25
**Severity**: High
**Component**: metrics, trust-resolver, certify, chat-tools
**Status**: Resolved
**Plan**: plans/complete/260525-0050-broken-metric-guard-and-certify-flow/

## What Shipped

Closes the four gaps the `244e19f` resolver work left open. cube_api's broken-ref UserError flood now has both a passive (auto-draft) and active (execution-time) guard, plus a human-driven path back to `certified` once refs are healthy.

### Phase 1 — `?game=` plumbed through callers

- `use-business-metrics.ts` accepts an optional `gameId`, threading it through a `Map<gameId, BusinessMetric[]>` cache (was `BusinessMetric[] | null` shared across all games). Subscribers, single-flight, and `refresh()` are keyed too.
- Two trust-displaying consumers (`MetricsTab`, `MetricDetailPage`) now pass `gameId`. Other consumers (sidebar, smart-search, concept-detail, data-model-tab) that only read metric IDs were intentionally left unchanged — passing `gameId` there would warm a separate cache key with no behavioural payoff.
- Chat tools `list_business_metrics` / `get_business_metric` append `?game=ctx.gameId` so the LLM sees the same downgraded trust the FE does.

### Phase 2 — Execution-time ref guard

- `src/lib/validate-metric-refs.ts` — pure FE port of `metric-ref-validator.ts` (≤60 LOC). Parity vitest exercises both against the same fixture.
- `useMetricRunnability(metric)` — reads `useCatalogMeta` and returns `{ status: 'ok'|'broken', missingRefs }`. Fail-open when meta is loading or empty.
- `metricOverrideStore` (Zustand) — session-scoped `Set<metricId>` of metrics the user has explicitly "Run anyway"-allowed. Not persisted; reload re-arms the guard.
- `MetricRunnabilityWarning` — yellow strip listing missing refs with a "Run anyway" button.
- `RightRail` "Open in Explore" is now gated by the warning. Disabled with a `Refs unresolved: ...` tooltip until override.
- Chat tools: `preview_cube_query` and `explain_cube_sql` now accept `force?: boolean`. Without force, both pre-validate query members against `/meta` and return `{ ok: false, error: 'metric_draft', missingRefs, hint }` if any are missing. The previous `unknown_member` shape on `explain_cube_sql` was unified into the same `metric_draft` response.

### Phase 3 — Certify flow

- `BusinessMetricSchema` extended additively with `meta.game_id` + `meta.trust_history[]` (Zod `passthrough()` so unknown YAML keys survive round-trip).
- `PATCH /api/business-metrics/:id/trust` — `{ trust, actor?, note? }`. Promoting to `certified` requires:
  - A resolvable game (`meta.game_id` or `?game=`); else `400 GAME_UNKNOWN`.
  - All formula refs resolve against `/meta`; else `400 REFS_UNRESOLVED { missingRefs }`.
- Demotion to `draft`/`deprecated` is unconditional — broken metrics can still be retired.
- Audit trail append-only at the API layer: server reads `prev.meta.trust_history`, appends a new `{ trust, at, actor?, note? }`, writes via existing `writeMetric` (atomic rename). Body fields trying to overwrite `trust_history` are dropped by the body Zod schema.
- FE `TrustControl` button group on `MetricDetailHeader` with antd confirm modal + toast on success/error. "Promote to certified" is disabled with a tooltip when `useMetricRunnability` returns `broken` — single source of truth with the Run-anyway warning.

### Phase 4 — Chat tool + drift summary

- Chat tool `update_business_metric_trust` (`id, trust, note?`) — thin wrapper around the PATCH endpoint via new `patchJson` helper in `server-client.ts`. Relays structured errors (`REFS_UNRESOLVED` with `missingRefs[]`, `GAME_UNKNOWN`, `NOT_FOUND`) so the LLM can explain failures in plain English.
- `GET /api/business-metrics/drift?game=<id>` — returns `{ total, resolvable, broken: [{ id, missingRefs }] }`. Reuses `getDrift` helper extracted from `metric-trust-resolver.ts` so endpoint + future CLI consumers agree on "broken".
- `DriftSummaryStrip` in catalog header — "X of Y metrics resolvable for {game}" with a "View N drafts" shortcut that adds `'draft'` to the filter rail's trust set.

## Decisions Worth Remembering

**FE port of validator vs single source of truth.** Validator lives canonically on server. FE port is ≤60 LOC + a parity test against the same fixture. Avoids monorepo wiring; the cost of keeping them in sync is one test.

**Override is session-scoped, never persisted.** A "Run anyway" click flips a Zustand `Set<metricId>`. Reload re-arms the warning. Rationale: broken metrics should keep being annoying — a one-time ack shouldn't grant immunity for the week.

**`unknown_member` → `metric_draft`.** The pre-existing `explain_cube_sql` `unknown_member` error was a single-ref form of the same problem. Unified both tools on `metric_draft { missingRefs[] }` so the LLM has one schema to reason about. `force: true` is the single bypass for both.

**Audit trail in YAML, not a DB.** Single-user playground. YAML stays the source of truth; trust_history append uses the same atomic rename as `writeMetric`. If multi-user lands later, an `If-Match`-style version header on PATCH is the obvious next step.

**No separate certify UI page.** Three buttons inline on the detail header beat a modal or dropdown. The "Promote to certified" disabled-state reuses the same `missingRefs` from `useMetricRunnability` — one mental model for "broken metric" everywhere it surfaces.

**Drift endpoint is its own route, not a derivation of `GET /api/business-metrics?game=`.** Means the existing `check-metric-drift.ts` CLI can call it without booting the catalog view, and both surfaces share the same `getDrift` helper.

## Test Coverage

- Server: 25 new tests (PATCH endpoint: happy/REFS_UNRESOLVED/GAME_UNKNOWN/idempotent/forged-history-ignored; drift endpoint: GAME_REQUIRED/snapshot/token-failure). Full suite: 193 passing.
- FE: 14 new tests (override store, validate-metric-refs parity, hook keyed cache). Full suite: 873 passing.
- Chat: 8 explain_cube_sql tests updated to `metric_draft` shape; new `force:true` bypass test. Full suite: 211 passing.

## Follow-ups

- The 45 broken preset YAMLs are still the underlying root cause. Now that auto-draft + execution-guard + certify flow are in place, fixing them one-by-one with audit-trail evidence is feasible.
- `certified-stale` visual state (distinguishes "never reviewed" from "was-certified-but-Cube-regressed") was deferred as YAGNI for single-user. Revisit if the registry grows to multiple human reviewers with review SLAs.
- The `check-metric-drift.ts` CLI script wasn't yet migrated to consume the new `/drift` endpoint — same numbers from a different code path. Optional consolidation later.
