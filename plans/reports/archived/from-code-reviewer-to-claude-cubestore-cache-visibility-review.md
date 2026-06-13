# Code Review — CubeStore cache visibility + readiness from-source hardening

Reviewer: code-reviewer · Date: 2026-06-13
Scope: Phase 1 (readiness `from-source` 4th state) + Phase 2 (CubeStore introspection)

## Files reviewed
Backend: `preagg-readiness.ts`, `preagg-run-merge.ts`, `cubestore-introspect.ts`,
`cubestore-query-cache-check.ts`, `routes/preagg-runs.ts`, `types/preagg-run.ts`
FE: `preagg-readiness-matrix.tsx`, `preagg-runs-tab.tsx`, `preagg-runs-data.ts`,
`cubestore-data.ts`, `cubestore-storage-panel.tsx`, `cubestore-query-cache-checker.tsx`
Config: `docker-compose.devcube.yml`
Tests cross-read: `cubestore-introspect.test.ts`, `cubestore-query-cache-check.test.ts`,
`preagg-run-merge.test.ts`, `preagg-runs-routes.test.ts`

## Verdict
Clean, well-scoped, defensively coded. No blockers. The acceptance criteria all
hold under inspection. Two should-fix items are correctness gaps that are latent
(only bite under inputs the current tests don't exercise), not regressions.

---

## Acceptance criteria — verification

1. **Accounting `built+fromSource+unbuilt+errored === totalRollups`** — VERIFIED.
   `computePreaggReadiness` derives each count by filtering the same `cubes[]` by
   disjoint status (readiness.ts:315-319); `/current` re-sums them and computes
   `totalRollups` as the sum of the four (routes:75-85). No double-count, no gap —
   every probe lands in exactly one of four mutually-exclusive `ProbeStatus` values.

2. **`from-source` never reads as serveable; sweep taxonomy unchanged** — VERIFIED.
   `classifyOutcome` keeps `sealed`/`stale_serving` keyed strictly to `built`
   (merge.ts:106-110); `from-source` folds into the `unbuilt`/`failed` branch.
   `serveable = cubeResult.status === 'built'` (merge.ts:200) — `from-source`
   is false. Test `from-source: … → unbuilt, not serveable` asserts both
   (`preagg-run-merge.test.ts:104-115`). `built`/`unbuilt`/`error` outcomes are
   byte-for-byte the prior taxonomy.

3. **Read-only / no SQL-injection surface** — VERIFIED.
   - `system.*` queries are three static string literals (introspect.ts:153-155);
     no interpolation.
   - The query-cache checker's user query goes to Cube `/sql` as a JSON body
     `{ query }` via `cubePost` (cube-client.ts:166-168) — never string-built into
     SQL. Cube returns the planned `tableName`; that string is then parsed by
     `logicalPreaggBase` (pure string ops) and compared by `===` against
     CubeStore bases already in memory. No untrusted string reaches a raw
     CubeStore SQL statement. The mysql2 calls take zero parameters.

4. **Admin-gated; disabled path returns `enabled:false` not 500; downed deps caught** — VERIFIED.
   Router-level `requireRole('admin')` + `requireFeature('admin')` preHandlers
   (routes:28-29). Routes test asserts 403 (editor) / 401 (unauth) and 200 +
   `enabled:false` when introspection off, for both endpoints
   (`preagg-runs-routes.test.ts:126-184`). `readCubestoreStorage` and
   `checkQueryCache` both wrap the DB/cube call in try/catch and return an `error`
   payload, never throw (introspect.ts:161-165, query-cache-check.ts:102-104).

5. **mysql2 pool: no leak, failure handled not re-thrown** — VERIFIED.
   `pool.query()` auto-acquires/releases — no manual `getConnection()`, so no leak.
   Pool is a module singleton (`connectionLimit: 2`, `connectTimeout: 8_000`),
   appropriate for a long-lived server. Failures are caught and returned as a
   payload (introspect.ts:161). Errors are NOT written to the TTL cache (`cache =`
   appears only in the success branch, line 159) — see Should-fix #2 nuance: a
   persistently-down CubeStore is retried every request, but each retry is calm
   (caught) and bounded by the 8s connect timeout; the panel is collapsed-by-default
   and only fetches on open, so the blast radius is small.

6. **Design-system: tokens only, sizes, kebab-case** — VERIFIED.
   All colors/radii/fonts use `var(--…)` tokens; no inline hex in the five new FE
   files. `var(--bg-subtle, var(--muted-soft))` is the only undefined token and is
   always written WITH a defined fallback — intentional and safe. All used tokens
   (`--info-soft/ink`, `--neutral-400`, `--danger`, `--live-badge-*`, etc.) exist
   in `tokens.css`. File sizes all reasonable (largest new FE file 137 lines;
   matrix 225 incl. heavy doc comments). Names kebab-case.

---

## Should-fix

- **S1. `findPreaggByTableName` ↔ CubeStore base matching is untested and relies on
  Cube's dry-run reporting the FULL physical tableName (with the 3-token version
  suffix).** The match in `findPreaggByTableName` (introspect.ts:173-184) only works
  because BOTH sides pass through `logicalPreaggBase`, which blindly strips the last
  3 underscore-tokens. CubeStore's `system.tables.table_name` carries the suffix
  (`…_batch20260601_<hash>_<hash>_<id>`), so it strips to the right base. The dry-run
  `tableName` must carry the *same* suffix shape, or the strip removes 3 REAL name
  tokens and the `===` never matches → every verdict silently degrades to `not-built`.
  Repro of the asymmetry (verified locally):
  - CubeStore stored base: `active_daily_dau_by_country_payer_daily_batch`
  - dry-run name WITH suffix → strips to same base → matches ✓
  - dry-run name WITHOUT suffix → strips to `active_daily_dau_by_country` → no match ✗

  `lessons-learned.md:735` documents that pre-agg table identity is
  `<schema>.<cube>_<preagg>_<hash>`, which strongly implies the dry-run DOES carry the
  hash — so this is almost certainly correct in practice. But it is the load-bearing
  assumption of the whole Phase-2 verdict and NO test exercises the real
  `logicalPreaggBase` on both sides (the query-cache test fully mocks
  `findPreaggByTableName`; the introspect test only strips CubeStore names).
  Recommend: one integration-shaped unit test feeding a realistic dry-run `tableName`
  (with hash suffix) through the real `findPreaggByTableName` against a real
  `aggregateCubestoreStorage` fixture, to lock the symmetry. Cheap insurance against
  a silent all-`not-built` regression if Cube ever changes the dry-run name shape.

- **S2. `logicalPreaggBase` can collapse two distinct rollups on the same cube into
  one group / one match when their physical names share the first N tokens AND differ
  only inside the stripped 3-token tail — or, conversely, the suffix-date regex can
  mis-strip.** The heuristic `slice(0, -3)` assumes exactly 3 trailing version tokens.
  Edge inputs:
  - A short physical name like `a_b_c_d` strips to `a` (over-strip) — unlikely for
    real rollups (names are long) but the function has no floor on base length.
  - The `/20\d{6}$/` date strip fires on ANY base ending in `20` + 6 digits, e.g. a
    hypothetical rollup whose logical name legitimately ends in a year-like token
    would lose it. Real rollup base names don't, so low risk.
  Grouping is by exact `schema|base` equality and the checker matches by exact base
  equality, so an over-strip would MERGE two rollups (showing one row with summed
  partitions, and a query to either resolving to the merged stats). Not observed in
  the real registry (the 5 curated cubes + ptg's funnel have distinct bases), but the
  function is a silent-merge risk if a future rollup name collides post-strip.
  Recommend a short comment documenting the "exactly 3 version tokens" assumption and
  that base names are assumed long enough that the strip can't reach a shared prefix.

## Nits

- **N1.** `buildFailureIndex` fallback branch (merge.ts:88-95) iterates existing
  index keys to attach a dotless-id failure by `tableName` substring — but it only
  matches cubes ALREADY in the index from a prior dotted id. A failure whose id has
  no dot and whose cube hasn't appeared yet is dropped. Pre-existing behavior, not
  introduced here; flagging only because it sits adjacent to the reviewed change.

- **N2.** `ServeabilityStrip` recomputes per-game `total` as
  `g.built + g.fromSource + g.unbuilt + g.errored` (tab.tsx:82) while the server
  already guarantees that equals `totalRollups`. Harmless duplication; if a future
  status is added, two places must change. Consider deriving from a shared helper.

- **N3.** `readCubestoreStorage` re-attempts on every call when CubeStore is down
  (errors uncached). Intentional and safe per AC#5, but if a host enables
  introspection with an unreachable CubeStore, each open of the panel pays the 8s
  connect timeout. The collapsed-by-default + on-open-only fetch keeps this tolerable;
  no change required, just noting the trade-off is deliberate and differs from the
  "cache errors" pattern in `preagg-readiness`/`segment-snapshot-runs` (there it's
  documented as intentional; here uncached-error is the better choice for a
  transient-wire dependency).

## Positive observations
- The `from-source` distinction is exactly the right honesty fix — a 200 that fell
  through to Trino was the silent green-but-passthrough trap, and it's now a first-
  class state end-to-end (probe → merge → /current → matrix tone → strip pill).
- Every external boundary fails calm: disabled → `enabled:false`, downed dep →
  `error` payload, bad input → 400. No path throws a 500 or leaks a stack trace.
- Pure functions (`aggregateCubestoreStorage`, `logicalPreaggBase`,
  `extractPlannedPreaggs`, `classifyOutcome`) are cleanly separated from I/O and
  unit-tested without a live CubeStore — good testability discipline.
- `BuildAction` correctly early-returns "no rollups in model" on empty cubes, so
  `toBuild = cubes.length - built` never renders a misleading "Build 0".

## Unresolved questions
- S1: has anyone captured a real `/sql` dry-run response from this Cube version to
  confirm `preAggregations[].tableName` includes the hash suffix? The whole Phase-2
  verdict hinges on it; `lessons-learned.md:735` implies yes but it's not pinned by a
  test or a captured sample in-repo.
