---
title: "Chat certify tool + catalog drift summary"
status: complete
priority: P2
effort: "~1.5h"
---

# Phase 05 — Chat certify tool + catalog drift summary

## Context Links

- PATCH endpoint from phase-03 of this plan: `PATCH /api/business-metrics/:id/trust`
- Chat tools registry: `chat-service/src/tools/registry.ts`
- Existing drift script: `server/src/scripts/check-metric-drift.ts`
- Catalog header host: `src/pages/Catalog/<header>.tsx` (locate via grep on the existing filter rail)

## Overview

Two small additions that close the loop:
1. A chat tool `update_business_metric_trust` so users can ask the assistant to promote/demote metrics conversationally — mirrors the FE PATCH 1:1.
2. A catalog header "Drift Summary" strip — "47 of 57 metrics resolvable for ballistar" — with a "View N drafts/stale" shortcut that flips the filter rail. Powered by a new tiny `/api/business-metrics/drift?game=…` endpoint that the existing `check-metric-drift.ts` script can also reuse for parity.

## Key Insights

- The chat tool is a thin wrapper; reuse the same error shapes (`REFS_UNRESOLVED`, `GAME_UNKNOWN`) so the LLM can explain failures in plain English.
- Drift endpoint output should be cheap: just `{ resolvable: number, total: number, broken: { id, missingRefs }[] }`. The existing resolver already computes everything; expose it.
- Keeping the dedicated endpoint (rather than deriving in FE from `/api/business-metrics?game=`) means the script can run server-only without booting the catalog view.

## Requirements

- F1. New chat tool `update_business_metric_trust(id, trust, note?)` — calls the PATCH endpoint with `ctx.actor || 'chat'` as actor.
- F2. Tool returns structured success/error matching the server response so the LLM doesn't fabricate explanations.
- F3. New endpoint `GET /api/business-metrics/drift?game=<id>` — returns `{ resolvable, total, broken: [{ id, missingRefs }] }`.
- F4. FE: catalog header "Drift Summary" strip — text + "View N stale" / "View N drafts" buttons that drive filter rail chips.
- F5. `check-metric-drift.ts` updated (optional) to consume the new endpoint OR share the resolver core, ensuring parity (no two divergent definitions of "broken").
- NF1. Drift endpoint must reuse the resolver cache (no extra `/meta` fetch when called right after `/api/business-metrics?game=…`).

## Architecture

```
chat ──► update_business_metric_trust(id, trust, note?)
                 │
                 ▼
       PATCH /api/business-metrics/:id/trust   (phase-03)


GET /api/business-metrics/drift?game=ballistar
                 │
                 ▼ reuses resolver cache + validator
            { resolvable: 12, total: 57,
              broken: [{ id:'npu', missingRefs:['mf_users.new_users'] }, …] }
                 │
                 ▼
   Catalog header ─── "12 of 57 metrics resolvable for ballistar"
                              ├── [View 45 stale/draft]  → opens filter rail with chips selected
                              └── [Refresh]              → re-fetches drift + meta
```

## Related Code Files

- Create: `chat-service/src/tools/update-business-metric-trust.ts`
- Modify: `chat-service/src/tools/registry.ts` — register new tool
- Modify: `server/src/routes/business-metrics.ts` — add `GET /api/business-metrics/drift`
- Create: `server/test/business-metrics-drift-endpoint.test.ts`
- Create: `src/pages/Catalog/metrics-tab/drift-summary-strip.tsx`
- Create: `src/pages/Catalog/metrics-tab/use-metric-drift.ts`
- Modify: `src/pages/Catalog/<catalog-header>.tsx` — mount the strip
- Modify (optional): `server/src/scripts/check-metric-drift.ts` — call the new endpoint or share helper

## Implementation Steps

1. Add `GET /api/business-metrics/drift` handler. Reuse `resolveTrustForGame` internals by exporting a `getDrift(metrics, gameId)` helper from the resolver module; route returns `{ resolvable, total, broken }`.
2. Server unit test the drift endpoint: known fixture → known counts; no game param → 400 GAME_REQUIRED.
3. FE `use-metric-drift(gameId)` — fetch + cache keyed by gameId; refresh when `useBusinessMetrics` refreshes.
4. FE `drift-summary-strip.tsx`: thin one-line component showing the counts and two text buttons. Buttons dispatch to the filter rail store to select the appropriate chip.
5. Mount the strip in the catalog header above the filter rail.
6. Chat tool `update-business-metric-trust.ts`:
   - Zod input: `{ id: string, trust: 'certified'|'draft'|'deprecated', note?: string }`
   - Implementation: `await fetchJson('/api/business-metrics/'+id+'/trust', { method:'PATCH', body: JSON.stringify({ trust, note, actor: ctx.user ?? 'chat' }) })`
   - On 4xx: return the structured error so the LLM relays it (`{ status:'error', code, missingRefs? }`)
7. Register the tool in `chat-service/src/tools/registry.ts`.
8. Add a tool-level replay test that exercises one success + one REFS_UNRESOLVED path against the local server.
9. (Optional) Update `check-metric-drift.ts` to print the same numbers the endpoint returns — confirms parity for tooling continuity.

## Todo List

- [ ] Extract `getDrift` helper in resolver module
- [ ] Add `GET /api/business-metrics/drift` route
- [ ] Server test for drift endpoint
- [ ] FE `use-metric-drift` hook
- [ ] FE `drift-summary-strip.tsx`
- [ ] Mount strip in catalog header
- [ ] Chat tool `update-business-metric-trust`
- [ ] Register in chat tools registry
- [ ] Replay test for the chat tool
- [ ] (Optional) Align `check-metric-drift.ts` with endpoint output

## Success Criteria

- C1. Catalog header shows e.g. "12 of 57 metrics resolvable for ballistar"; clicking "View 45 stale/draft" selects the corresponding filter chips and updates the list.
- C2. Chat: "promote `paying_users` to certified" → assistant calls the tool → 200, badge flips. Same call for `npu` (broken) → assistant relays the REFS_UNRESOLVED error and lists missing refs.
- C3. `tsx server/src/scripts/check-metric-drift.ts` and `curl /api/business-metrics/drift?game=ballistar` report identical broken-id sets.
- C4. Drift fetch reuses resolver cache: hitting `/api/business-metrics?game=X` then `/api/business-metrics/drift?game=X` fires only one `/meta` fetch (verified via cube_api logs).

## Risk Assessment

- R1. Drift endpoint and `/api/business-metrics?game=` could drift apart. Mitigation: both call the same `getDrift`/resolver core; shared test fixture.
- R2. Chat tool surface area grows. Mitigation: keep schema minimal — three fields, no enum sprawl.
- R3. Filter rail already renders the canonical `[Certified] [Draft] [Deprecated]` chips after `244e19f`; this phase reuses them as-is, no restyle dependency.

## Security Considerations

- Drift endpoint is read-only and doesn't expose anything beyond what `/api/business-metrics?game=…` already does — same trust boundary.
- Chat tool inherits PATCH endpoint's localhost-only trust assumption.

## Next Steps

- After all 4 phases ship: re-measure cube_api UserError rate over a 10-minute dev window. Target met if `'not found for path'` count is <5% of `Load Request Success` count.
- Follow-up plan (not in scope here): actually fix the 45 broken preset YAMLs (the underlying root cause). Once those are clean, the certify flow lets the team flip them back to certified one by one with an audit trail.
