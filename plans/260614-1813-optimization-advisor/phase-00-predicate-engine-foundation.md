# Phase 00 — Predicate-engine foundation (derived-date + percentile)

> **This is the foundation gap, verified 2026-06-14.** The Segments builder can express only 15 scalar
> operators (`server/src/types/predicate-tree.ts:6-21`; UI `src/pages/Segments/editor/predicate-builder/operators.ts:14-46`).
> A peer cohort IS a Segment — so for the Advisor's three predicate classes to work, the Segments compiler
> must learn two new ones. Trino + Cube already support `approx_percentile`; the gap is purely the compiler.

## Overview
- **Priority:** P0 (everything peer/baseline downstream needs it).
- **Status:** pending.
- Generalize the existing Care two-pass percentile pattern (`server/src/care/threshold-rule.ts:57-71`,
  `server/src/care/calibrate.ts:109-112`) into the Segments predicate tree so "top-quartile LTV" and
  "tenure 6–18mo" are first-class, not invented demo chips.

## The three predicate classes (what the engine must handle)
| Class | Example | Compiles to | Status today |
|---|---|---|---|
| **Direct** | `last_login_country = 'VN'`, channel, device, os | native Cube filter / single scalar SQL | ✅ works (15 ops) |
| **Derived relative-date** | tenure 6–18mo (`first_login_date`), not-lapsed (`last_active_date`) | `date_diff(...)` computed at query time | ❌ no operator |
| **Statistical / percentile** | top-quartile LTV, above-median ARPPU | two-pass: `approx_percentile(col, p)` cutoff → then `>=` filter | ❌ no operator |

## Key insights
- **Reuse, don't reinvent:** Care already models a `PercentileRule { of, p, gate, op }` and resolves it to an
  absolute cutoff via a calibration step. Lift that resolution into the predicate compiler so BOTH Care and
  Segments share one percentile path. (Care's cutoff resolution is itself unwired — `calibrate.ts:109-112`
  — so this phase finishes a job that's already half-specified.)
- **Percentile population must be explicit.** The cutoff must be computed over the *reference population*
  (e.g. all cfm_vn payers), not the target cohort, or "top quartile" is circular. The operator value carries
  an explicit `over` population (default = same game, all members of the dimension's cube).
- **Derived-date is cheaper than percentile** (no second pass — just `date_diff` in the WHERE/filter). Ship
  it first; it covers tenure + recency which are the most common peer axes.
- **Cube REST filters don't support subqueries** → percentile needs the two-pass (resolve cutoff, then a
  scalar `gte` filter), exactly like Care. Raw-SQL path (`predicate-to-sql.ts`) can inline the subquery.

## Requirements
Functional:
1. **Extend `LeafOperator`** (`server/src/types/predicate-tree.ts`) with:
   - `dateWithinLast` / `dateBeforeLast` (relative-date, value = `{n, unit:'day'|'month'}`) — derived class.
   - `percentileGte` / `percentileLte` (value = `{p:number, over?:PopulationRef}`) — statistical class.
2. **Compiler — Cube path** (`server/src/services/translator.ts`):
   - derived-date → translate to an absolute `inDateRange` / `beforeDate` using "today" anchor (deterministic; pass `asOf`).
   - percentile → mark as **two-pass**: emit a cutoff-resolution query, then a scalar `gte/lte` filter against the resolved value. Reuse Care's resolver.
3. **Compiler — SQL path** (`server/src/services/predicate-to-sql.ts`):
   - derived-date → `date_diff(unit, col, DATE 'asOf') <= n`.
   - percentile → `col >= (SELECT approx_percentile(col, p/100.0) FROM <population>)` inline subquery.
4. **Shared percentile resolver** — extract Care's cutoff resolution into a reusable
   `resolvePercentileCutoff(member, p, over, asOf)` so Care `calibrate.ts` and the Segments compiler call the same code.
5. **UI** (`src/pages/Segments/editor/predicate-builder/operators.ts` + the leaf editor):
   - NUMBER_OPS gains "top X%" / "bottom X%" (percentile) with a population picker.
   - TIME_OPS gains "within last N days/months" / "before last N" (derived-date).
   - Each operator tagged with its class (direct/derived/statistical) so the UI can show the same legend the prototype now uses.

Non-functional: `asOf` always passed (no `Date.now()` baked in compiler — reproducible); percentile cutoff query date-partition-pruned; population defaults safe.

## Related code files
Modify:
- `server/src/types/predicate-tree.ts` (operator enum + value schemas)
- `server/src/services/translator.ts` (Cube filter mapping + two-pass marker)
- `server/src/services/predicate-to-sql.ts` (SQL generation, incl. percentile subquery)
- `server/src/care/threshold-rule.ts` + `server/src/care/calibrate.ts` (call the shared resolver instead of inline)
- `src/pages/Segments/editor/predicate-builder/operators.ts` + the predicate leaf editor component
Create:
- `server/src/services/percentile-cutoff-resolver.ts` (shared two-pass resolver; lifted from Care)

## Implementation steps
1. Add the 4 operators + value schemas to `predicate-tree.ts`; keep the union exhaustive (TS will flag every switch that must handle them).
2. Write `percentile-cutoff-resolver.ts`: given `(member, p, over, asOf, connector)` → run `approx_percentile`, return the numeric cutoff. Cover the `over` = full-cube-population default.
3. Repoint `care/calibrate.ts` cutoff resolution at the shared resolver; confirm Care tests still pass (`server/test`).
4. Extend `translator.ts`: derived-date → absolute range; percentile → resolve-then-scalar-`gte`. Document the two-pass contract in the function header (no plan refs in code).
5. Extend `predicate-to-sql.ts`: derived-date `date_diff`; percentile inline subquery over the population.
6. UI: add operators + class tags + population picker; mirror the prototype's direct/derived/statistical legend.
7. `npm --prefix server run build` + `npm run build`.

## Todo
- [ ] operators + value schemas (`predicate-tree.ts`)
- [ ] `percentile-cutoff-resolver.ts` (shared)
- [ ] repoint Care `calibrate.ts` at the resolver; Care tests green
- [ ] Cube translator: derived-date + two-pass percentile
- [ ] SQL compiler: derived-date + percentile subquery
- [ ] UI operators + class tags + population picker
- [ ] compile clean (server + web)

## Success criteria
- A Segment with "top-quartile lifetime_vnd over cfm_vn payers" compiles and returns a non-empty member list whose min LTV ≈ the P75 of the population.
- A Segment with "first_login within 6–18 months" compiles to a deterministic absolute range given `asOf`.
- Care percentile path still works through the shared resolver (no regression).
- The Segments UI shows the same three-class legend as `optimization-advisor.html` Peer Studio.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Percentile population mis-scoped (circular) | M×H | `over` explicit; default = dimension's full cube population, never the target cohort. |
| Cube REST can't subquery | H×M (known) | two-pass resolve-then-scalar, reusing Care's proven pattern. |
| `asOf` nondeterminism | M×M | thread `asOf` through compiler; never call `Date.now()` inside compile. |
| Care regression when sharing resolver | M×H | run `server/test` Care suite before/after; resolver is additive. |

## Security (PII)
Percentile/derived operators select only the keyed numeric/date member + identity — no contact columns. Covered by the Phase 5 column-allow-list regression.

## Next steps
Phase 1 (lens engine) consumes the percentile + derived-date operators for lens A (percentile) and the peer match (B). Phase 3 surfaces the class legend in the Peer Studio.
