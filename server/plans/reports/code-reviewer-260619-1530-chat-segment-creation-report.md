# Code Review — Chat-driven segment creation (measure-threshold / top-N / percentile cohorts)

Date: 2026-06-19 (GMT+7)
Scope: uncommitted changeset across server/, chat-service/, src/ (FE). Reviewed the segment-creation feature files; ignored unrelated monitor-tab/downsample refactors also present in the working tree.

## Verdict: ship (no blockers). Two SHOULD-FIX items below are correctness/defense-in-depth, not release-blocking.

---

## 1. SQL injection / percentile SQL correctness — PASS

Traced every path that reaches Trino. No user-controlled raw string reaches the query builder.

- `buildPercentileSql` / `buildMergedFrom` (percentile-cutoff-resolver.ts): `table`, `column`, `merge.idColumn`, every `merge.column` go through `assertIdent` (`/^[a-zA-Z_][a-zA-Z0-9_]*(\.…)*$/`). `p` clamped to [0,100]. `split_part_at` is the only accepted transform (enum, throws otherwise). `agg` collapses to `'sum'|'max'` only. The `where` fragment is documented + used as predicateToSql output only.
- `predicate-to-sql.ts` percentile branch (the only diff in this file): now compiles `over.filter` via `predicateToSql(over.filter, opts)` — recurses the same trusted compiler, never a raw fragment. Correct.
- `resolveCutoffPreview` (segment-cutoff-resolver.ts): `table`/`column` via `escapeIdent`; `where` via `predicateToSql`; the matched-count comparison interpolates `escapeLiteral(cutoff)` where `cutoff` is a JS number (number branch of escapeLiteral, safe). `merge`'s `where` and the outer `${column} ${cmp}` both bind to the merged-grain projected names — consistent.

Note (pre-existing, NOT this change): `escapeLiteral`'s control-char guard `/[ --]/` is mislabeled — that char class is the *range* space(0x20)→dash(0x2D), so it rejects printable chars `! " # $ % & ' ( ) * + , -` and does NOT reject tab/newline/CR/null. It is not an injection hole (strings are still single-quote-doubled), but the comment "control chars are rejected" is false and the guard would throw on a legitimate string literal containing a space/comma/paren. The segment-creation values today are numeric (recharge/active-days) and `st_*` tokens with no chars in that range, so no live impact. Out of scope for this changeset; mention only so a future string-valued population filter doesn't trip it.

## 2. Population-scoping invariant — PASS (with one SHOULD-FIX on enforcement locus)

- Catalog (`segmentable-measures.json`): every spend/spend_usd/spend_30d entry carries `defaultPopulation` = `recharge_col > 0` (payers). `active_days` correctly has `defaultPopulation: null` (count distribution is meaningful unscoped).
- Cutoff query is payer-scoped at create (`resolveSegmentCutoffs` → `over.filter` → WHERE), refresh (same call), and `/resolve-cutoff` preview. The cohort/membership query (Cube `gte cutoff` on `mf_users.ltv_vnd`) is NOT itself payer-scoped, but the resolved cutoff is a positive payer-p value so `ltv_vnd >= cutoff` excludes the 0-spend free users automatically → cohort ⊆ payers. Invariant holds.
- jus identity-merge: the cutoff (and the preview's pop/matched counts) collapse per-user via `split_part(user_id,'@',1) … GROUP BY` (max), matching the cube's own collapse, so cutoff grain == cohort grain. `mergeSpecFor` projects the percentile column AND every `over.filter` column so the WHERE binds post-merge. Correct.

SHOULD-FIX (S1): the catalog allowlist (`isCatalogTarget`) is enforced ONLY on `/resolve-cutoff` (routes/segments.ts:582). The CREATE path (`POST /api/segments` → `resolveSegmentCutoffs(tree)`, line 454) and refresh resolve the percentile over whatever `over.table`/`over.column`/`over.filter` the caller put in the predicate_tree, with no catalog re-validation. Not an injection (idents are assertIdent-validated, filter is predicateToSql-escaped, and route is behind global `authenticate`), but an authenticated workspace member crafting a raw POST body could (a) point `approx_percentile` at any ident-valid `schema.table.column` reachable by the Trino connector (info-disclosure / resource use), or (b) drop the payer `filter` and get an unscoped → 0 cutoff that selects everyone. The chat/FE flow always passes catalog values, so normal use is safe.
Fix: in the create path, for each percentile leaf, assert `isCatalogTarget(game_id, over.table, over.column)` before resolving (reuse the `/resolve-cutoff` guard), and optionally re-stamp `over.filter` from `percentileOverFor(catalogEntry)` rather than trusting the caller's filter. File: server/src/routes/segments.ts around line 454.

## 3. Care path regression — PASS

`care/calibrate.ts:125` calls `resolvePercentileCutoff(cond.of, {p,over}, createTrinoPercentileExecutor(connector))` with NO 4th arg → `opts` defaults to `{}` → no `where`/`merge` → identical behavior to the old `where?: string` signature when undefined. The new optional `opts` object is backward-compatible. `percentile-cutoff-resolver.test.ts` (9 tests) and the Care-relevant assertions pass.

## 4. Non-percentile no-op — PASS

`resolveSegmentCutoffs` calls `collectPercentileLeaves` first and returns an empty Map with zero Trino calls when there are no percentile leaves (line 102). Refresh guards with `collectPercentileLeaves(tree).length > 0` before any cutoff work (refresh-segment.ts:188). A plain threshold/equals segment makes no extra round-trip. Confirmed by test.

## 5. Contract seam (chat-service ↔ FE) — PASS

`propose-segment.ts` `SegmentProposal` ≡ chat-service `types.ts` SseEvent `segment_proposal.data` ≡ FE `segment-proposal.ts` `SegmentProposalPayload` ≡ FE `chat-sse-client.ts` `SseSegmentProposal.data`. Fields name/game_id/cube/predicate_tree/resolved{cutoff?,estCount,populationCount?,population}/disclosures/suggestedVisibility match in all four. FE Create POSTs `{name,type:'predicate',cube,game_id,predicate_tree,tags:['ai-generated'],visibility}` — matches acceptance criteria.

## 6. Refresh failure handling — PASS

Cutoff resolution wrapped in `withTimeout(…, PER_SEGMENT_TIMEOUT_MS)`. A timeout message ("timed out after") and Trino conn errors match `TRANSIENT_ERROR_RE` → restored to `stale` (retried), not mismarked broken. A structural error (bad column, `PercentileNotResolvedError`) is non-transient → `broken` (correct fail-closed). The translator throws `PercentileNotResolvedError` if a leaf's cutoff is missing, so an unresolved percentile can never silently emit an unscoped membership query.

## 7. General

SHOULD-FIX (S2) — dead code: `chat-service/src/utils/cube-query-to-predicate-tree.ts` (237 LOC) is imported only by its own test; no production caller in chat-service/src. The propose flow builds the tree directly from the catalog measure and never uses this converter. Either wire it (the order+limit→percentile guard suggests it was meant to bridge an existing playground query into a proposal) or drop it to avoid an orphaned 237-LOC surface + test. Verify before deleting — it may be the intended seam for a "save THIS query as a segment" follow-up.

NICE-TO-HAVE (N1) — file size: `chat-service/src/tools/propose-segment.ts` is 608 LOC, over the 200 guideline. The bilingual `buildDisclosures` (~75 lines) and the three `handle*` paths are cleanly separable into a `propose-segment-disclosures.ts` + `propose-segment-paths.ts`. Not urgent; logic is well-organized.

NICE-TO-HAVE (N2) — `cube-query-to-predicate-tree.ts` operator map: `notContains → notEquals`, `startsWith/endsWith → contains` are lossy approximations. Harmless today (no caller), but if wired they'd silently change query semantics on round-trip. Document or reject these ops rather than coercing.

Verified clean: no AI-attribution strings, no plan-artifact references (phase numbers / finding codes) in any added code or comment. The `predicate-to-sql.ts` "binary" git-diff is a UTF-8 em-dash (U+2014) in a comment tripping git's binary heuristic — not a real binary file; `--text` diff shows only the `where:` addition.

## Metrics
- New/changed pure-logic tests: server 26 pass (3 suites), chat-service 29 pass (2 suites). All green locally.
- Type-checks reported clean by task context (server/chat-service/FE).

## Unresolved questions
1. Is `cube-query-to-predicate-tree.ts` intended for a not-yet-wired "save this query as segment" path, or is it orphaned? Determines whether S2 is "wire it" or "delete it".
2. Should the create/refresh path re-stamp `over.filter` from the catalog (hard-enforce payer scope) or only validate `(table,column)`? Affects whether a caller can intentionally build an unscoped percentile segment.

**Status:** DONE_WITH_CONCERNS
**Summary:** Feature is correct and injection-safe across all six focus areas; tests green. Two SHOULD-FIX items: catalog allowlist not enforced on the create/refresh percentile path (only on the preview), and a 237-LOC dead-code util in chat-service. Neither blocks release.
**Verdict:** ship (address S1 + S2 in a follow-up; confirm the two unresolved questions).
