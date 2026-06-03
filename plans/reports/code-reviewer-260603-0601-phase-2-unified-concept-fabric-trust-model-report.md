# Code Review — Phase 2 Unified Concept Fabric (canonical registry + unified trust model)

Scope: P2 diff vs HEAD. Files reviewed (all listed in brief).
Verification: server `tsc --noEmit` clean; 3 new P2 test files pass (28/28).

## Verdict

Implementation is solid and matches spec on most axes. **One High-severity tenancy/correctness bug** at the route boundary (owner identifier mismatch) that makes acceptance criterion (g) misleading and breaks owner-scoped segment relations under real auth. Everything else is Low/nit or explicitly-correct.

---

## Critical

None.

## High

### H1 — Owner scope uses `email`, but segments are owned by `claims.sub` → owner filter never matches in prod (and silently disabled in dev)
`server/src/routes/concepts.ts:30`
```ts
const owner = (req.user as { email?: string } | undefined)?.email ?? null;
```
The reverse index scopes segments by `segments.owner = ?`. But segments are written with `owner = req.owner` (`server/src/routes/segments.ts:177,423`), and `req.owner` is set to **`claims.sub`** in real-auth mode (`server/src/middleware/authenticate.ts:111,116`), not the email. `sub` (Keycloak UUID) and `email` are distinct JWT claims (`authenticate.ts:103` vs `:105`).

Consequences:
- **Real auth:** caller's email never equals any `segments.owner` (a sub-UUID) → the owner predicate excludes *every* real segment, so `segments` and field→segment relations come back empty for legitimately-owned rows. Feature silently returns nothing.
- **Dev / auth-disabled:** `devUser()` has **no `email` field** at all (`authenticate.ts:63`), so `owner` resolves to `null` → the `if (owner)` guard in `concept-reverse-index.ts:142` is skipped → owner scoping is **entirely disabled**, segments filtered by game only.

Why tests didn't catch it: `concept-reverse-index.test.ts` calls `getRelations(..., { owner: 'user@company.com' })` directly and inserts segments with that same email as `owner`, so the function-level scoping passes. The mismatch only exists at the **route→service** seam, which has no test.

Fix: scope by the same identifier segments are written with. Use `req.owner` (provenance owner), not `req.user.email`:
```ts
const owner = (req as { owner?: string }).owner ?? null;
const relations = getRelations(ref, { gameId: readGameId(req), owner });
```
This aligns the read scope with the write scope.

Note on criterion (g): given `segments.ts:1-8`, segments are **workspace-shared, not owner-private** ("`owner` records provenance, not a private boundary"). The *real* tenant boundary today is `game_id` (workspace), not `owner`. So the owner filter is stricter than the product's actual access model. Two valid resolutions — decide explicitly:
- (a) If concept-relations should mirror segment visibility, drop the owner predicate and scope by `game_id` only (matches `segments.ts` read model). Then criterion (g) is satisfied by game scoping, and the cross-owner test should be re-framed.
- (b) If concept-relations are intentionally tighter (owner-only), fix the identifier per above so it actually works. But this diverges from how `/api/segments` lists rows, which is a surprising inconsistency.
Recommend (a) for consistency with the existing segment authz model; flag to lead/PM since it touches the stated security criterion.

---

## Medium

None that are defects. (See L-series for nits.)

---

## Low / Nits

### L1 — `?trust=` alias cannot express `deprecated` (intentional, but undocumented asymmetry)
`server/src/routes/glossary-validators.ts:110` allows `trust ∈ {certified, draft}` only; `glossary.ts:96` maps `certified→official`, else `draft`. Correct for glossary (no deprecated status exists). The mapping is sound. Minor: the `Trust` type has 3 values but the alias accepts 2 — fine, just confirm no caller expects `?trust=deprecated` to filter (none does today; verified no FE/chat client sends `?trust=`).

### L2 — `danglingRefs` issues one `SELECT 1 FROM segments` per segment ref (N+1-ish on write only)
`server/src/routes/glossary.ts:81`. Bounded by `CatalogIds.max(20)` so worst case 20 point-lookups on PK — negligible, write path only. No action needed; noting for completeness.

### L3 — `danglingRefs` will throw if `segments` table is absent at runtime
`server/src/routes/glossary.ts:81` runs `SELECT 1 FROM segments` unguarded. In prod the table always exists (migration 011), so not a real risk, but it is fragile: any env that loads glossary routes without the segments migration would 500 on a glossary write that includes a `segments/<id>` ref. The reverse-index `build()` has the same assumption (`concept-reverse-index.ts:144`). Acceptable given the single-DB deployment; optionally wrap in a table-exists guard if glossary is ever extracted to a service without segments. Brief explicitly flagged this as "note if fragile" — noted, not blocking.

### L4 — `req.user as { email? }` cast bypasses the typed `AuthenticatedUser`
`server/src/routes/concepts.ts:30`. Once H1 is fixed by switching to `req.owner`, this ad-hoc cast disappears. If kept, prefer the real request type over an inline structural cast.

---

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| a | Typed refs across 3 namespaces, no parent_term | MET. Grammar `REF_RE` (`trust-mapping.ts:56`) + allowlist enforced on write (`glossary-validators.ts:17-29`). No parent_term field anywhere. |
| b | whale/dolphin/minnow → field + measure (seed) + segments via reverse index | MET. Seed backfills `entity_cube`/`default_measure_ref`/`trust_tier` (`glossary.seed.json`); reverse index links term→segment via shared `mf_users.payer_tier` field (data_model namespace), confirmed by tests. |
| c | Reverse index field→metrics, metric→terms, field→segments; cache keyed by (game,owner), invalidated on write | MET for the three edge directions and version-bump invalidation. Cache key `${gameId}::${owner}` partitions tenant data correctly; org-wide metrics/terms shared safely. **Caveat:** the `owner` half of the key is mis-sourced at the route (H1) — the keying mechanism is correct, the value fed in is wrong. |
| d | Unified visibility×trust readable; legacy reads unbroken | MET. `rowToTerm` derives `trust`/`visibility` from legacy columns (`glossary-row-mapper.ts:120-124`); legacy `status`/`trustTier` still emitted. No row rewrite. Migration 027 columns stay reserved. |
| e | chat-service still parses (additive optional) | MET. `TermSchema` trust/visibility are `.optional()`; mapper does not propagate them to `OfficialTerm` (no domain-type break). |
| f | Dangling refs rejected; grammar rejects unknown ns / `..` | MET. `danglingRefs` covers business_metrics (loader) + segments (DB); data_model grammar-only (documented). `isValidRef` rejects unknown namespace and `..`; tested. |
| g | Term cannot dereference another tenant's personal segment | **NOT MET as written** (see H1). The owner predicate is bypassed in dev and never matches in prod due to the email-vs-sub mismatch; the actual enforced boundary is `game_id`. Game scoping works (test `respects game_id scoping`). Owner scoping does not function end-to-end. |

## Specific checks requested

1. `glossaryTrust()` mapping — **correct**: experimental→draft, official(non-exp)→certified, draft→draft (`trust-mapping.ts:30-31`). `?trust=` alias→status — **correct** (L1 note on deprecated).
2. Tenancy — segments scoped by `game_id AND owner` in `build()` (correct SQL); cache key safe, no cross-tenant bleed in the cache structure. **But owner value is mis-sourced (H1).**
3. Migration 027 — purely additive + nullable, forward-only. `user_version` logic safe: 27 sorted files, `files.slice(currentVersion)` applies only `027`, then `user_version = files.length (27)`. No count drift. **Correct.**
4. Dangling-ref guard — handles all three namespaces correctly; segments SELECT is unguarded but prod-safe (L3).
5. Blast radius — no FE/chat consumer breaks. FE `GlossaryTerm` gained required `trust`/`visibility` but all consumers *receive* terms from server; the one test fixture is an untyped literal through a mocked fetch (no TS enforcement). Metric `visibility` key is `.optional()` — no YAML break. `tsc` clean.
6. Plan-artifact refs in code — **none found.** Comments say "Phase 02a concept-tier" in a couple of places (`glossary-validators.ts:34`, `glossary-row-mapper.ts:29`, `business-metric.ts` neighbors) — these are pre-existing from P2a, not introduced here, but per project rule §5 "Phase 02a" is a plan-artifact reference and should be reworded to describe the *why* (e.g., "concept-tier optional fields"). Low priority, pre-existing.
7. Patterns — follows existing Fastify module shape, `getDb().prepare()` prepared statements, service-module style. Consistent. `concepts.ts` namespace allowlist guard mirrors existing 400-on-bad-input convention.

## Positive observations

- Trust mapping isolated to one pure module (`trust-mapping.ts`) — single source of truth, well-tested (10 tests).
- Derive-on-read approach (no row rewrite) keeps 027 trivially reversible (forward-only runner needs no down-migration). Good call documented in the SQL header.
- `collectMembers` recursive walk with `MEMBER_RE` guard + try/catch on malformed JSON is robust (tested with `{not valid json]`).
- Cache invalidation via global version counter is simple and correct; every glossary write route calls `invalidateReverseIndex()`.
- Ref grammar rejects `..` both via regex char-class and explicit `!ref.includes('..')` belt-and-suspenders.

## Recommended actions (priority order)

1. **(H1)** Decide the segment visibility model for concept-relations and fix `concepts.ts:30`: either scope by `req.owner` to match the write identifier, or drop owner and scope by `game_id` only to match the existing segment read model. Add a route-level test that inserts a segment via the real owner path and reads it back through the endpoint, to close the seam tests currently miss.
2. (L3) Optionally guard `SELECT 1 FROM segments` / reverse-index segment query behind a table-exists check if glossary may ever run without segments.
3. (Nit) Reword "Phase 02a" comments to describe intent, not plan phase (project rule §5).

## Unresolved questions

- Is concept-relations meant to mirror the workspace-shared segment model (`game_id` boundary) or be strictly owner-private? The code, tests, and brief criterion (g) disagree with the actual `/api/segments` authz model. This is a product/security decision — needs lead/PM confirmation before H1 is fixed one way or the other.
