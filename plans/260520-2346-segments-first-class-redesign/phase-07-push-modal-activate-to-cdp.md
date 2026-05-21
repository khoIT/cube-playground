---
phase: 7
title: "Push-modal Activate to CDP"
status: pending
priority: P1
effort: "2.5d"
dependencies: [2, 4]
brainstormId: P5
---

# Phase 7 (P5): Push-modal Activate to CDP

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §8 + §17
- Mockup: `../visuals/segments-first-class-mockup.html` — Push modal screen, Activate to CDP tab
- MM-01 spec: `../reports/MM-01-CRUD.openapi.yaml`
- Existing push modal: `src/pages/Segments/push-modal/push-modal.tsx`

## Overview

Add **Activate to CDP** as a 3rd tab on the push-modal. Derives `metric_name`, `expression`, `filter`, `dimensions`, `source` from segment context. Submits to MM-01 (`POST /cdp/v1/metrics`) via a new client stub, then appends to `segment.activations[]` via Phase 4's endpoint. Server-side `predicate-to-sql.ts` translator generates the SQL `filter` string from `predicate_tree`. Backend CDP is wired as a stub (mockable per env flag) so UI ships now even when downstream CDP service is offline.

## Key Insights

- The activation tab is the **payoff** of the entire redesign: it makes segments useful outside this tool.
- Predicate→SQL translation owned server-side (single source of truth; reusable by future refresh-job direct-push).
- Modal field count kept tight: most fields auto-derived; user only picks env, dimensions, optional materialize+cron.
- `metric_name` derivation: `segment_<kebab-slug>_member` where slug = lowercase, `[a-z0-9_]`, ≤64 chars, derived from `segment.name`.
- `expression = COUNT(DISTINCT <identity_field>)`. Identity field comes from preset or segment definition.
- `source` derivation: `game_integration.bi_<game>.etl_<cube>` — pattern lives in a small util to allow per-game override later.
- MM-01 client behind a feature flag so backend wiring lands without dragging Phase 7 into the same release.

## Requirements

**Functional**
- 3rd modal tab `Activate to CDP` (alongside `Create new` / `Append to existing`).
- Tab body fields:
  - **Summary card** (header): "Activating from segment {name} · {uid_count} users · cube {cube} · identity {identity}".
  - **Game** (read-only): chip rendering active game + "Switch game" link returning to Header picker.
  - **Metric name**: input, prefilled with derived value, validates regex `/^[a-z0-9_]{1,64}$/`.
  - **Environment**: radio dev/stag/prod (default prod).
  - **Dimensions**: multiselect, options from cube schema. Default `server_id`, `platform` if present.
  - **Materialize on schedule**: checkbox. When checked, reveal cron input (5-field format). When unchecked, cron field hidden + cleared.
  - **Advanced (collapsed)**: fold revealing derived `expression`, `filter` (SQL preview from server), `source`. Read-only with copy button.
- Footer: `Cancel` · `Activate` primary pill (disabled until form valid).
- Submit flow:
  1. Client POSTs to MM-01 `POST /cdp/v1/metrics` via new `cdp-metrics-client.ts`.
  2. On 200, client POSTs to `/segments/:id/activations` (Phase 4 stub) with the new `Activation` payload.
  3. Optimistic UI: append to local segment state immediately, rollback on failure.
  4. Toast: "Activated to CDP · {env}".
- Server: new `server/src/services/predicate-to-sql.ts` translates `PredicateNode` tree to SQL `WHERE` string. New endpoint `GET /segments/:id/sql-filter` returns the translated string for the Advanced preview.
- Feature flag `VITE_CDP_ACTIVATION_ENABLED` (env var or `gds.config.json` field):
  - `true` → MM-01 client posts to real endpoint.
  - `false` → mock client returns success after 500ms delay; no real network call.
- Detail Activation tab `+ Activate to CDP` CTA (Phase 5) opens push-modal with the third tab focused + payload pre-filled (no row selection needed when launched from Detail).

**Non-functional**
- `predicate-to-sql.ts` has full unit test coverage (every operator + group nesting).
- Output SQL must be safely parameterized (no string concatenation of user-supplied values without escape).
- Modal body ≤ 200 LOC. Extract:
  - `push-modal/tabs/activate-to-cdp-tab.tsx` (form)
  - `push-modal/derive-metric-name.ts` (slug logic)
  - `push-modal/derive-source.ts`
- New `src/api/cdp-metrics-client.ts` ≤ 150 LOC.

## Architecture

```
src/pages/Segments/push-modal/
  ├─ push-modal.tsx                       — orchestrator; add 3rd tab
  ├─ tabs/
  │   ├─ create-tab.tsx                   NEW — extract from existing
  │   ├─ append-tab.tsx                   NEW — extract from existing
  │   └─ activate-to-cdp-tab.tsx          NEW
  ├─ derive-metric-name.ts                NEW
  ├─ derive-source.ts                     NEW
  └─ use-sql-filter.ts                    NEW — fetches /sql-filter for Advanced preview

src/api/cdp-metrics-client.ts             NEW — MM-01 client (real + mock)

server/src/services/
  └─ predicate-to-sql.ts                  NEW — translator
server/src/services/__tests__/
  └─ predicate-to-sql.test.ts             NEW
server/src/routes/segments.ts             — new GET /:id/sql-filter handler
```

## Related Code Files

**Create**
- `/Users/lap16299/Documents/code/cube-playground/server/src/services/predicate-to-sql.ts`
- `/Users/lap16299/Documents/code/cube-playground/server/src/services/__tests__/predicate-to-sql.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/api/cdp-metrics-client.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/tabs/create-tab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/tabs/append-tab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/tabs/activate-to-cdp-tab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/derive-metric-name.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/derive-source.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/use-sql-filter.ts`

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/push-modal.tsx` (orchestrator; 3 tabs; reduced to ≤150 LOC after extraction)
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` (new GET `/:id/sql-filter` handler)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/activation-tab.tsx` (Activate CTA opens push-modal with `tab=activate`)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/segments.module.css` (modal field styles, radio-group, multiselect, advanced fold)
- `/Users/lap16299/Documents/code/cube-playground/gds.config.json` (optional `cdpActivationEnabled: boolean` flag)
- `/Users/lap16299/Documents/code/cube-playground/src/i18n/*` (Activate tab labels, toasts, validation messages)

**Delete** — none.

## Implementation Steps

1. **`predicate-to-sql.ts`** — Translator with all `LeafOperator` cases. Output uses parameterized placeholders or properly-escaped literals. Helper `escapeIdent()` for column names; `escapeLiteral()` for values.
2. **Unit tests** — One test per operator. Tests for nested AND/OR groups. Tests for `inDateRange` formatting. Tests for SQL injection resistance.
3. **Server endpoint** — `GET /segments/:id/sql-filter` returns `{ filter: string }` from translator.
4. **`cdp-metrics-client.ts`** — Methods: `createMetric(payload)`, `countMetrics(gameId)`, `listMetrics(gameId, params)`. Behind `VITE_CDP_ACTIVATION_ENABLED`. Mock variant returns Promise.resolve.
5. **`derive-metric-name.ts`** — Pure function: segment.name → kebab slug → `segment_<slug>_member`, capped at 64 chars.
6. **`derive-source.ts`** — Pure function: `(gameId, cube) => \`game_integration.bi_${gameId}.etl_${cube}\`` with override hook.
7. **`use-sql-filter.ts`** — Fetches translated SQL for Advanced preview; cached per `(segmentId, predicate_version)`.
8. **Extract existing tabs** — Move current Create / Append bodies into `tabs/create-tab.tsx` + `tabs/append-tab.tsx`. Push-modal.tsx becomes tab router only.
9. **`activate-to-cdp-tab.tsx`** — Form per Requirements. Validation: name regex, env required, dimensions array non-empty optional. Submit handler chains MM-01 POST → activations POST.
10. **push-modal.tsx orchestrator** — 3 tabs. Accept optional `initialTab` prop so Detail's Activate CTA can open directly on the 3rd tab. Accept `segmentId` prop for Detail launch (no row selection needed).
11. **Detail integration** — Activation tab (Phase 5) `+ Activate to CDP` button opens push-modal with `initialTab='activate'` and pre-filled segment context.
12. **Feature flag wiring** — Default OFF in dev (mock). Document toggle in README / `gds.config.json`.
13. **Empty/error states** — When flag is OFF, banner inside Activate tab reads "CDP wiring is in mock mode — submissions are simulated."

## Todo List

- [ ] `predicate-to-sql.ts` translator
- [ ] `predicate-to-sql.test.ts` covering all operators + groups + SQL-injection resistance
- [ ] Server `GET /segments/:id/sql-filter`
- [ ] `cdp-metrics-client.ts` (real + mock)
- [ ] `derive-metric-name.ts` + tests
- [ ] `derive-source.ts`
- [ ] `use-sql-filter.ts`
- [ ] Extract `tabs/create-tab.tsx` from push-modal
- [ ] Extract `tabs/append-tab.tsx` from push-modal
- [ ] `tabs/activate-to-cdp-tab.tsx`
- [ ] Slim `push-modal.tsx` to ≤150 LOC orchestrator
- [ ] Wire Detail Activation CTA to open modal on Activate tab
- [ ] Feature flag wiring + mock-mode banner
- [ ] i18n labels + toasts + validation strings
- [ ] Manual QA: end-to-end submit (mock mode) appends activation to segment

## Success Criteria

- [ ] Activate-to-CDP tab visible in push-modal.
- [ ] All derived fields populate from segment context.
- [ ] Submit (mock mode) appends to `segment.activations[]` and updates UI optimistically.
- [ ] Submit (real mode) calls MM-01 `POST /cdp/v1/metrics`; failure rolls back UI + shows error.
- [ ] `predicate-to-sql.ts` test coverage ≥ 90%.
- [ ] Advanced preview shows correct SQL.
- [ ] Modal closes cleanly post-success; toast appears.
- [ ] Detail Activation tab CTA opens modal on Activate tab with pre-filled context.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| SQL injection via leaf values in predicate-to-sql | **H** | Parameterized values only; explicit allow-list for column names; unit-test attack strings (`'; DROP TABLE--`); reviewer signs off on translator before merge |
| MM-01 endpoint unavailable in dev → blocks testing | M | Mock mode default in dev; gated by `VITE_CDP_ACTIVATION_ENABLED` |
| `metric_name` collision on retry (409 METRIC_EXISTED) | M | Client checks for 409, surfaces "Metric already exists — re-use existing?" affordance; or auto-update path via PUT (deferred) |
| Detail CTA opens modal with stale segment after async load | L | Pass segmentId; modal re-fetches segment on mount |
| Predicate translator misses an operator → silent SQL omission | M | Translator throws on unknown operator; client surfaces error; tests cover every enum value |
| Cron schedule field accepts invalid expressions | L | Use existing cron-parsing util (or `cron-validator` npm pkg); show parse error inline |
| Real MM-01 client lacks auth wiring | M | Phase 7 ships JWT bearer header pattern from CLAUDE.md auth conventions; admin token via env until SSO lands |

## Security Considerations

- **SQL injection** is the #1 risk. Allow-list column identifiers against a known schema list before emitting SQL. Escape string literals via single-quote doubling + reject control chars.
- MM-01 client must send Bearer JWT (`Authorization: Bearer <token>`) — reuse existing security-context bearer.
- `metric_name` validated server-side AND client-side against `/^[a-z0-9_]{1,64}$/`.
- Activation `last_error` field may contain upstream messages — redact known PII patterns (email, phone) before persisting per Phase 4 §Security.
- Feature flag default OFF in prod-style envs until backend acceptance.

## Next Steps

Final segments-domain phase. Unblocks Phase 8 (Catalog polish referencing same DS patterns) only by precedent; no hard dep. Phase 9 dark-mode pass audits modal.
