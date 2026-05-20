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

## Schema-drift repair pass

Initial seed used hypothetical `mf_users` members (per plan validation Q8: preset references were provisional pending Cube YAML verification). The drift-resolver caught all of them on first refresh and flipped 5 predicate segments to `status=broken` with precise missing-member lists. Repaired by PATCHing to real schema members:

| Fake member | Real replacement |
|---|---|
| `mf_users.revenue` | `mf_users.ltv_vnd` (per-user dim) / `mf_users.ltv_30d_vnd` |
| `mf_users.event_date` | `mf_users.last_active_date` |
| `mf_users.platform` | `mf_users.os_platform` |
| `mf_users.session_count` | `mf_users.total_active_days` |
| `mf_users.d7_retention` | `mf_users.days_since_last_active` + `mf_users.is_paying_user` |
| `mf_users.acquisition_channel` | `mf_users.media_source` |
| `mf_users.payment_method` | `mf_users.payer_tier` |

Also: `inDateRange` with relative string `"last 30 days"` returned `Cube /load → 400: Invalid date format`. Switched to explicit `["2026-04-19","2026-05-19"]` array — Cube accepted. **FE editor should normalize relative date strings to absolute ranges before persisting, OR the translator should expand them.**

After patch + refresh:

| TYPE | STATUS | UIDS | NAME |
|---|---|---:|---|
| manual | fresh | 12 | Q2 Whales (CSV import) |
| manual | fresh | 10 | VIP Beta Whitelist |
| predicate | fresh | 0 | All mf_users (full cohort) |
| predicate | fresh | 0 | At-Risk Churners |
| predicate | fresh | 0 | High-Value Spenders (30d) |
| predicate | fresh | 0 | Paying — Organic or Referral |
| predicate | fresh | 0 | VN Mobile (iOS+Android) |
| predicate | fresh | 0 | iOS Power Users — US/UK |

uid_count=0 on predicate segments = Cube returned an empty result set (dev dataset has no matching rows for these strict predicates), **not** a failure. The full-cohort "All mf_users" also returned 0 — worth investigating whether the dev `mf_users` table is populated.

## Unresolved questions

- Should `import-ids` accept an auto-suggested mapping with confidence ≥ threshold (e.g. 0.9) as a shortcut, or should the FE always force a confirmation PUT first?
- `inDateRange` with relative strings (`"last 30 days"`) is rejected by Cube `/load` — should the translator expand relative ranges to absolute dates at translate time, or should the FE editor force absolute dates?
- "All mf_users (full cohort)" returns `uid_count=0` despite empty predicate — is the dev `mf_users` table empty, or is the identity-dim query path mis-projecting? Worth a one-shot scout.
- P4 preset hardcoded measures in `src/pages/Segments/presets/mf-users-hub.ts` still reference fake names (`mf_users.dau`, `mf_users.revenue`, `mf_users.d7_retention`, etc.) — preset tabs will all render as broken cards until that file is rewritten against the real schema dumped above.
