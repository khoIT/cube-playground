# Sample Segments Seed — Functional Verification

**Plan:** `plans/260519-1610-query-results-to-segments/`
**Target server:** `http://localhost:3004` (Fastify, owner=`khoitn`, X-Owner header auth)
**Approach:** Hit live API to seed segments matching plan description; assert payload + verify side effects.

## Result overview

| Check | Result |
|---|---|
| POST /api/segments (predicate, AND root + leaves) | ✅ 7/7 created |
| POST /api/segments/import-ids (CSV → manual segment) | ✅ created after identity-map upsert |
| PUT /api/identity-map/:cube | ✅ override stored, `source=manual` |
| GET /api/segments?owner=khoitn | ✅ 8 rows returned, owner-scoped |
| GET /api/segments?owner=* | ✅ 9 rows (includes pre-existing `tester` row) |
| Translator validation (`op:"likes"`) | ✅ 400 `TRANSLATOR_ERROR` — `Unsupported operator: "likes" (member=mf_users.country)` |
| Zod validation (missing `name`) | ✅ 400 `VALIDATION` with full Zod path |
| POST /api/segments/:id/refresh (predicate) | ✅ 202 `{status:"refreshing"}`; status later flips to `broken` (Cube unreachable in dev — expected) |

## Sample segments created (owner=khoitn)

| Type | Name | Cube | Cadence | Tags | Predicate shape exercised |
|---|---|---|---:|---|---|
| predicate | High-Value Spenders (30d) | mf_users | 60m | monetization, priority | AND root → `gte` + `inDateRange` |
| predicate | iOS Power Users — US/UK | mf_users | 240m | engagement, ios | AND with nested OR group (US ∨ UK) + numeric `gte` |
| predicate | At-Risk Churners | mf_users | 1440m | churn, retention | AND root → `lt` + `beforeDate` |
| predicate | VN Mobile (iOS+Android) | mf_users | 360m | geo, mobile | AND with `equals` + `in` (multi-value) |
| predicate | All mf_users (full cohort) | mf_users | 1440m | baseline | empty AND group (no filters) → `{filters:[]}` |
| predicate | Paying — Organic or Referral | mf_users | 720m | acquisition, monetization | AND with nested OR + valueless `set` operator |
| manual | VIP Beta Whitelist | mf_users | — | beta, manual | 10 uids inline, no predicate |
| manual | Q2 Whales (CSV import) | mf_users | — | monetization, whales | 12 uids parsed from CSV body, truncated=false |

## Translator round-trip verification

Cube filter JSON serialized correctly for each predicate (spot-checked from POST response `cube_query_json`):

- Multi-value `in` → Cube `equals` with array values (per translator map `in → equals`)
- OR group → `{"or":[…]}` wrapper
- `set` operator → no `values` key in emitted filter
- Empty AND group → `{"filters":[]}` (no wrapper)
- `inDateRange` / `beforeDate` → values preserved as strings

## Observations

1. **Refresh → broken status**: refreshing the "Paying — Organic or Referral" segment flipped status to `broken` after the cron worker drained the queue. Expected here — there is no live Cube backend on this dev host. Confirms the broken-status path from phase-08 works end-to-end (queue → worker → broken_reason update).
2. **Auto-suggest is not sufficient for Import IDs**: `/api/segments/import-ids` rejects when `cube_identity_map` row is absent even when an auto-suggested mapping exists. CSV import requires a real (manual or accepted-auto) row. Worth surfacing in the UI before the CSV picker opens.
3. **Owner enforcement**: `?owner=*` correctly bypasses scoping while default GET filters to the request's X-Owner. Pre-existing `tester` row stayed invisible to khoitn until `*` requested.

## Unresolved questions

- Should `import-ids` accept an auto-suggested mapping with confidence ≥ threshold (e.g. 0.9) as a shortcut, or should the FE always force a confirmation PUT first?
- "Broken" reason for predicate segments is stored, but no test ran end-to-end against a *live* Cube — would recommend a follow-up smoke test against the `cube-dev` mf_users schema before declaring P6/P8 truly done.
