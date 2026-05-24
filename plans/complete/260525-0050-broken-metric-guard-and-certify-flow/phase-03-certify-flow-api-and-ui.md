---
title: "Certify flow API + UI"
status: complete
priority: P1
effort: "~3h"
---

# Phase 04 — Certify flow API + UI

## Context Links

- Route: `server/src/routes/business-metrics.ts` — add `PATCH /api/business-metrics/:id/trust`
- Loader: `server/src/services/business-metrics-loader.ts` — already exposes `writeMetric` (atomic write + cache refresh)
- Schema: `server/src/types/business-metric.ts` — additive `meta.trust_history?: TrustHistoryEntry[]`
- Validator: `server/src/services/metric-ref-validator.ts` — gate certified transitions
- Metric-detail header: locate via grep on `<TrustBadge` to find host components

## Overview

Add the missing human action: any user can promote a metric to `certified | draft | deprecated`, with an immutable in-YAML audit trail. Server-side gates the `certified` transition behind a successful ref-validation against the metric's primary game `/meta` (no certifying broken metrics). Single-user-dev semantics: no role auth, actor is best-effort from a `x-actor` header or query param.

## Key Insights

- `writeMetric()` already does atomic YAML write + in-memory cache refresh — reuse it. No new I/O layer.
- The `certified` precondition check must use **the metric's declared primary game** (read from `meta.game_id` or the route's `?game=` if provided), not a hardcoded `ballistar`.
- Audit entries live in YAML under `meta.trust_history[]`. Each entry: `{ trust, at: ISO8601, actor?: string, note?: string }`. Append-only; the route never rewrites prior entries.
- Promotion to `draft` or `deprecated` is unconditional — only `certified` has the ref-validation gate.

## Requirements

- F1. New route: `PATCH /api/business-metrics/:id/trust` — body `{ trust: 'certified'|'draft'|'deprecated', actor?: string, note?: string }`.
- F2. When target is `certified`, server fetches `/meta` for `meta.game_id || req.query.game`, runs `validateRefs`. If `!ok`, return `400` with `{ error: { code: 'REFS_UNRESOLVED', missingRefs: [...] } }`.
- F3. On success, append to `meta.trust_history[]`, write YAML via `writeMetric`, return `200` with updated metric (including new history entry).
- F4. Zod schema: add `meta.trust_history` (optional array, each entry strictly typed). No breaking changes to existing fields.
- F5. FE: `TrustControl` dropdown on metric-detail header — "Promote to certified" / "Mark draft" / "Mark deprecated". Disabled with tooltip when ref-precondition would fail. Toast on success.
- F6. After a successful PATCH, FE invalidates `useBusinessMetrics` cache for the active game so the badge reflects the new state.
- NF1. Audit history is append-only at the API level (server rejects body fields trying to overwrite `trust_history`).
- NF2. Idempotent: PATCH with the same target trust appends a new history entry (intentional — records re-affirmations).

## Architecture

```
                                 PATCH /api/business-metrics/:id/trust
                                            │
              ┌─────────────────────────────┼────────────────────────────┐
              ▼                             ▼                            ▼
     parse + Zod-validate body     target === 'certified'?       writeMetric(next)
              │                             │                            │
              │                       yes ──┴── resolveTokenForGame      │
              │                             │   getMeta(token)           │
              │                             │   validateRefs(metric,m)   │
              │                             │   !ok → 400 REFS_UNRESOLVED│
              ▼                             ▼                            ▼
       prev = getById(id)         append { trust, at, actor?, note? }  refresh cache
              │                  to next.meta.trust_history             │
              └──────────────────────────┬───────────────────────────────┘
                                         ▼
                                    return 200 + next
```

## Related Code Files

- Modify: `server/src/routes/business-metrics.ts` — add PATCH handler
- Modify: `server/src/types/business-metric.ts` — extend Zod schema (`meta.trust_history?: TrustHistoryEntry[]`)
- Modify: `server/src/services/business-metrics-loader.ts` — confirm `writeMetric` re-serializes `meta.trust_history` (likely already does via blanket serialize)
- Create: `server/test/business-metrics-patch-trust.test.ts` — covers happy path, REFS_UNRESOLVED on certified, idempotent re-PATCH, history append shape
- Modify: `src/pages/Catalog/metric-detail/<header>.tsx` — host the `TrustControl`
- Create: `src/pages/Catalog/metric-detail/trust-control.tsx` — dropdown menu component
- Create: `src/pages/Catalog/metric-detail/use-trust-control.ts` — submit PATCH + invalidate cache
- Modify: `src/pages/Catalog/metrics-tab/business-metric-types.ts` — mirror `trust_history` type

## Implementation Steps

1. Extend Zod: `TrustHistoryEntrySchema = z.object({ trust: TrustEnum, at: z.string().datetime(), actor: z.string().optional(), note: z.string().max(280).optional() })`. Add `trust_history: z.array(...).optional()` to `meta`.
2. Add PATCH handler (≤80 LOC). For `target === 'certified'`:
   - Resolve game = `prev.meta?.game_id ?? req.query.game ?? null`
   - If no game: 400 `{ code: 'GAME_UNKNOWN' }` (we can't validate refs)
   - `resolveCubeTokenForGame(game)` + `getMeta(token)` + `validateRefs(prev, meta)`
   - If unresolved: 400 `{ code: 'REFS_UNRESOLVED', missingRefs }`
3. Build `next = { ...prev, trust: target, meta: { ...prev.meta, trust_history: [...(prev.meta?.trust_history ?? []), entry] } }`.
4. `await writeMetric(next)`; return `200`.
5. Server tests: happy, refs-unresolved, missing-game, idempotent re-PATCH, history append order, body that tries to set `trust_history` directly is ignored.
6. FE `trust-control.tsx`: shadcn-style menu with three items. On click → confirm dialog (small, not blocking the whole page) → PATCH. Disabled state for "Promote to certified" reuses the runnability check from phase-02 (`useMetricRunnability(metric).status === 'broken'`); disabled-tooltip = "Refs unresolved: mf_users.paid_installs, …" using the same `missingRefs` list. This keeps a single source of truth between "Run gated" and "Certify gated".
7. `use-trust-control.ts`: posts `fetch('/api/business-metrics/'+id+'/trust', { method:'PATCH', body:JSON.stringify({trust, note}) })`, on 200 calls `useBusinessMetrics().refresh()`, toasts success; on 400 toasts the structured error.
8. Smoke: take a known-broken metric, try to promote → 400 surfaces missingRefs; mark deprecated → 200, badge flips, YAML file shows new history entry on disk.

## Todo List

- [ ] Extend Zod schema with `trust_history`
- [ ] Implement PATCH handler with refs-gate
- [ ] Server unit tests (happy / refs-unresolved / missing-game / idempotent)
- [ ] FE `trust-control.tsx` component + confirm dialog
- [ ] FE `use-trust-control.ts` hook
- [ ] Wire `TrustControl` into metric-detail header
- [ ] FE smoke test: promote a clean metric, demote a broken one
- [ ] Verify on-disk YAML history append

## Success Criteria

- C1. `PATCH /api/business-metrics/npu/trust { trust:'certified' }` with `?game=ballistar` returns `400 REFS_UNRESOLVED` listing missingRefs.
- C2. `PATCH /api/business-metrics/<a-clean-metric>/trust { trust:'certified', note:'reviewed by data team' }` returns `200`, YAML on disk has new history entry, badge flips to certified on next FE refresh.
- C3. Promote-to-certified menu item is disabled with tooltip for metrics whose phase-02 runnability check returns `broken`.
- C4. Trying to PATCH `trust_history` directly is silently dropped (server only appends).

## Risk Assessment

- R1. YAML round-trip drift: writing `trust_history` may reorder or reformat unrelated fields. Mitigation: the existing `writeMetric` test suite already covers field-order preservation — extend with a history-append fixture.
- R2. Concurrent PATCHes lose history entries. Mitigation: read `prev` immediately before `writeMetric` and rely on fs atomic rename in the existing loader; document this is best-effort single-user. Add a `If-Match`-style version header if multi-user lands.
- R3. `actor` is forgeable. Mitigation: it's a single-user dev tool — accept best-effort; document it.

## Security Considerations

- No auth gate per phase-decision. Endpoint should still be limited to localhost in dev (Fastify default + dev proxy).
- `note` field is bounded at 280 chars; HTML-escape on render (existing TrustBadge tooltip already does this).
- Server rejects body trying to set `trust_history` directly to prevent audit-trail rewriting.

## Next Steps

- Phase-04 wraps the same PATCH as a chat tool and adds the catalog drift summary surface.
