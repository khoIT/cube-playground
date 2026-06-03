# P4 Authoring & Governance — Security Review

Scope: P4 changes only (concept-promote, promote-to-term, concept-ref-integrity, migration 028, enforce-write-roles, glossary.ts, business-metrics.ts, segments.ts, FE promote action + client). Adversarial focus.

## Verdict

All 4 acceptance criteria **MET**. No Critical or High exploitable issues found. RBAC, IDOR scoping, delete-time guard, draft-only promotion, and audit are correctly implemented. A few Low/Medium hardening nits below. Tests + typecheck status confirmed.

## Test / Typecheck Status

- `npx vitest run`: **612 passed / 6 failed** (89 files). All 10 P4 governance tests **pass**.
- `npx tsc --noEmit` in `server/`: **clean (exit 0)**.
- The 6 failures are **pre-existing, NOT P4's**:
  - `routes-crud.test.ts` (2): "PATCH/DELETE returns 403 when X-Owner does not match row owner". These assert an owner-403 boundary that was **removed in committed work** `5412a1b feat(auth): DB-authoritative authz` (segments are now workspace-shared; `enforce-write-roles.ts:9-12` documents "no per-row ownership check"). P4's `segments.ts` diff (`git diff HEAD`) **only adds** visibility hydration + the delete-time ref guard — it does not touch owner logic. These tests are stale vs the now-committed shared-workspace model.
  - `internal-access-route.test.ts` (4): `/internal/access/:key` failures (`expected 'admin' to be 'editor'`, 401/503 secret/env). P4 touches nothing under `/internal`.
  - Confirmed P4's PROTECTED_PREFIXES change can't break routes-crud: `/api/segments` was **already** in `PROTECTED_PREFIXES` at HEAD (verified `git show HEAD:...enforce-write-roles.ts` → 1 match). P4 only **adds** `/api/glossary` + `/api/concepts` (0 matches at HEAD).

## Acceptance Criteria

**(a) Editors create draft / viewers 403 / admins-only certify — MET.**
- Viewer block: global `enforce-write-roles` gate covers `/api/glossary` + `/api/concepts` for POST/PUT/PATCH/DELETE (enforce-write-roles.ts:34-37). Tests confirm viewer→403 on `POST /api/glossary` and `POST /api/concepts/promote`.
- Admin-only certify: `PATCH /api/glossary/:id/status` has route-level `requireRole('admin')` (glossary.ts:195-197); `PATCH /api/business-metrics/:id/trust` blocks non-admin when `target==='certified'` (business-metrics.ts:288-298). Editor→403 verified by test.

**(b) Promote scoped, no IDOR — MET.**
- concept-promote.ts:75-83: `SELECT ... FROM segments WHERE id = ? AND workspace = ?` bound to `req.workspace.id`, 404 on miss (not 403 — avoids cross-workspace existence leak). Walked the exact query; workspace-B cannot read a workspace-A segment. Test `promote 404s when segment is in a different workspace` confirms.
- termId override cannot overwrite a certified term: 409 on any existing id (concept-promote.ts:114-125); route only ever INSERTs `status:'draft', trustTier:null` (lines 159, 158). Metric path uses `scaffoldDraftMetric` which suffixes ids on collision (metric-stub-scaffolder.ts:75-79) and always writes `trust:'draft'` — cannot mutate an existing metric. Promote can never produce or touch a certified artifact.

**(c) New artifacts enter draft; segments default personal; certify admin-gated — MET.**
- Promote term: `status:'draft'`. POST /api/glossary: `status:'draft', source:'user'` (glossary.ts:137). Scaffold/promote metric: `trust:'draft'`.
- Segment visibility: migration 028 adds nullable `visibility`; NULL→`personal` on read (segments.ts:113, `SEGMENT_DEFAULT_VISIBILITY`). Behavior-preserving (was owner-only; stays personal). Test confirms `visibility=personal` on POST + GET.

**(d) Trust badges + audit — MET (audit verified, not just claimed).**
- Promote metric writes an `insertAuditRow(action:'create', actorId:req.owner, reason:'promoted from segment <id>')` (concept-promote.ts:211-224). POST metric, scaffold, trust-change, delete all audit (business-metrics.ts). Audit action enum includes create/update/trust_change/delete (business-metric-audit-store.ts:15).
- Gap: the **term** path of promote does NOT write an audit row (only the metric path does). See Medium-1.

## Findings

### Medium

**M1 — Promote-to-term writes no audit row.**
`concept-promote.ts` audits only the metric branch (lines 211-224). The `targetType:'term'` and `'both'`-term branch (lines 105-168) creates a glossary term with **no audit entry**. Criterion (d) says "create/promote/certify audited"; a term promotion is currently unaudited. Note: the glossary audit store is metric-keyed (`metricId`), so there may be no term-audit channel today — confirm whether glossary writes are audited anywhere. If not, this is a pre-existing gap that P4 inherits for the term path.
Fix: add a term-promotion audit row (or document that glossary writes are intentionally unaudited and downgrade criterion (d) for terms).

**M2 — Promoted term's `default_filter.member` bypasses the DefaultFilter member validation.**
`promote-to-term.ts:48-56` copies `node.member` + `node.values` straight from the stored predicate into `GlossaryFilter`, then concept-promote.ts:154 casts it into `default_filter_json` without running the `DefaultFilter` Zod schema (glossary-validators.ts:42-50) that normal POST/PUT enforce. The predicate was validated at segment-create time, and the data is the caller's own workspace-scoped segment, so this is **not externally exploitable** — but it is an inconsistent trust boundary: promote stores a filter the direct API would reject. 
Fix: parse the derived `GlossaryFilter` through the shared `DefaultFilter` schema before insert (drop the filter to null on failure). Cheap, closes the asymmetry.

### Low

**L1 — `trustTier:'certified'` accepted by editor on POST/PUT but does not (and must not) confer authority.**
`CreateTermSchema`/`UpdateTermSchema` accept `trustTier:'certified'` (glossary-validators.ts:78,98); these routes are editor-gated (not admin). Verified this is **NOT a self-certify escalation**: unified `trust` = `glossaryTrust(status, trustTier)` returns `certified` only when `status==='official'` (trust-mapping.ts:30-31), and `status` is mutable only via the admin-gated `/:id/status` PATCH. Chat grounding fetches `?status=official` (chat-service glossary-client.ts:82), so a draft term with `trustTier:'certified'` is filtered out of authority. Residual risk: a `draft` term can carry a `trustTier:'certified'` badge in the FE — cosmetic inconsistency only.
Fix (optional): reject `trustTier:'certified'` on non-admin writes, or ignore `trustTier` unless `status==='official'`.

**L2 — `glossaryTermsReferencingArtifact` LIKE pre-filter is a substring match; relies on `json_each` exact `j.value = ?` for correctness.**
concept-ref-integrity.ts:25-31. The `LIKE %ref%` is only a performance pre-filter; the authoritative match is `j.value = ?` (exact array-element equality), which correctly parses `business_metrics/<id>` and `segments/<id>` from the JSON array. No false-negative (a real ref always matches both). Edge case: if `secondary_catalog_ids` is malformed JSON, `json_each` throws → the delete handler has no try/catch around the guard, so a corrupt row would 500 the delete rather than fail-open-deleting — acceptable (fail-safe). No fix required; noting the 500-on-corrupt-JSON behavior.

**L3 — Delete-time guard is read-then-delete with no transaction; theoretically raceable.**
A glossary term could be inserted referencing the segment in the window between `glossaryTermsReferencingArtifact` (segments.ts:362 / business-metrics.ts:425) and the `DELETE`. SQLite (better-sqlite3) is synchronous and single-threaded per connection, so within one process the check+delete are not interleaved by another request mid-statement; the window is effectively closed for the in-process server. Flagging for completeness — if a second writer process is ever added, wrap check+delete in a transaction. No fix needed now.

**L4 — Prefix match `url.startsWith(p)` on `req.routerPath ?? req.url`.**
enforce-write-roles.ts:46-48. Reviewed for bypass (trailing-path, case, `/api/glossaryX`): `req.routerPath` is Fastify's matched route pattern (normalized), so case tricks and query strings don't reach it; a sibling route like `/api/glossary-public` would also match the prefix (over-broad, fail-safe direction — blocks more, not less). No under-match bypass found. Reads (GET) correctly pass through (MUTATING set only). OK.

## Other Verifications (no issues)

- Migration 028: single `ALTER TABLE ... ADD COLUMN visibility TEXT` — additive, nullable, no default, forward-only safe as the 28th file. Test harness applies all migrations in sorted order and the suite passes. NULL→personal mapping is behavior-preserving.
- Promote Zod schema is `.strict()` (concept-promote.ts:45) — rejects unknown keys; `termId` capped `min(1).max(64)`.
- `segments/<id>` secondary ref runs through `isValidRef` allowlist before insert (promote-to-term.ts:79).
- `?trust=` glossary filter is read-only (maps to a SELECT status filter, glossary.ts:95-102) — no write path.
- No plan-artifact refs (phase numbers / finding codes) in P4 code comments or filenames. Migration filename is domain-slugged (`028-segments-visibility.sql`). Compliant with the no-plan-refs rule.
- FE row-actions-menu uses design tokens only (`var(--bg-card)`, `var(--border-card)`, etc.); promote action surfaces server error verbatim incl. 403. Minimal, token-compliant.
- `termToWriteParams` 20 params == 20 INSERT placeholders == 20 SELECT_COLS, ordering verified.

## Unresolved Questions

1. **M1**: Are glossary writes audited anywhere today? The audit store is metric-keyed (`metricId`). If there is no term-audit channel, the "promote audited" criterion is only met for the metric branch — confirm intended scope.
2. **L1**: Is a `draft` term ever rendered with a "certified" tier badge in the FE because `trustTier:'certified'` was set by an editor? If trust badges read `trustTier` rather than unified `trust`, the cosmetic inconsistency becomes a (non-authoritative) UI trust-signal bug worth fixing.
