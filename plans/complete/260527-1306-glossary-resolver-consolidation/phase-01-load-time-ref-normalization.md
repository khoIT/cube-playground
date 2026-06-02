# Phase 01 — Load-time ref normalization + ratio composition

## Context Links
- `server/src/routes/glossary.ts` — list endpoint (`SELECT_COLS`, `rowToTerm` mapping, ETag)
- `server/src/routes/glossary-row-mapper.ts` — `GlossaryTerm` wire type, `rowToTerm`
- `server/src/services/business-metrics-loader.ts:77` — `getById(id)` returns `BusinessMetric`
- `server/src/types/business-metric.ts:28-50` — `formula` discriminated union (measure / ratio / expression)
- `server/src/index.ts:33,55-59` — `loadAll` at boot; business-metrics + glossary both registered
- `server/src/presets/business-metrics/revenue.yml` — `formula.ref: recharge.revenue_vnd`
- `server/src/presets/business-metrics/rr.yml` — ratio formula (numerator/denominator)

## Overview
- **Priority:** P1 — foundational; everything downstream consumes the normalized member.
- **Status:** done
- Resolve each term's `primary_catalog_id` → its catalog `formula.ref` at glossary-list time,
  emitting a new `measureRef` (cube member) wire field. Generic: no per-term seed edits.

## Key Insights
- `primary_catalog_id` is stored as `business_metrics/<id>` (slash) in the seed
  (`glossary.seed.json` revenue entry), but the catalog id is just `<id>` (e.g. `revenue`).
  Normalization must strip the `business_metrics/` prefix before `getById`.
- Catalog id with no matching YAML → `measureRef = null` (term still usable as alias, but
  resolver will down-rank / clarify). Do not throw.
- `formula.type === 'measure'` → `measureRef = formula.ref`. Common case.
- `formula.type === 'ratio'` → emit `ratioRef = { numerator, denominator }` (both are cube
  members straight from the catalog formula, e.g. `rr` → `retention.retained_d7` /
  `retention.cohort_size`). `refKind = 'ratio'`. The resolver + query-composer (Phase 02) build a
  ratio query from these so ratio terms auto-run like measures (user decision: full generic).
- `formula.type === 'expression'` → `measureRef = null`, `refKind = 'expression'` → clarify
  (YAGNI until a real expression case demands composition).
- `default_measure_ref` (existing column) remains an explicit override and wins over the derived
  formula (treated as `refKind: 'measure'`).

## Requirements
- Functional: GET `/api/glossary` (and `/:id`) returns `measureRef` + `refKind` per term.
- Functional: derivation precedence = `default_measure_ref` > `formula.ref` (measure) > null.
- Non-functional: zero added DB columns (derive on read; the catalog is the source of truth).
- Non-functional: ETag semantics unchanged for callers; but see Risk — catalog edits must not
  serve stale `measureRef`.

## Architecture / Data flow
```
glossary_terms row ─┐
                    ├─ rowToTerm ──┐
business-metrics ───┘             ├─ deriveMeasureRef(term, loader.getById) ─→ { measureRef, refKind }
loader.getById(catalogId)         │
                                  └─→ GlossaryTerm{ …, measureRef, refKind } ─→ JSON ─→ chat-service
```
- New pure helper `server/src/routes/glossary-measure-ref-resolver.ts`
  (`deriveMeasureRef(primaryCatalogId, defaultMeasureRef, getById)`), unit-testable, no Fastify dep.
- `routes/glossary.ts` calls it inside the list/by-id map step.

## Related Code Files
- **Create:** `server/src/routes/glossary-measure-ref-resolver.ts` (<60 LOC pure fn).
- **Modify:** `server/src/routes/glossary-row-mapper.ts` — add `measureRef`, `refKind` to
  `GlossaryTerm` wire type (NOT to `GlossaryRow` — derived, not stored).
- **Modify:** `server/src/routes/glossary.ts` — import resolver + loader `getById`; map over rows.
- **Modify (test):** `server/test/...` (Phase 05 owns).

## Implementation Steps
1. Add `measureRef: string | null`, `ratioRef: { numerator: string; denominator: string } | null`,
   and `refKind: 'measure' | 'ratio' | 'expression' | 'unknown'` to `GlossaryTerm` in
   `glossary-row-mapper.ts`. Do not touch `GlossaryRow` / SQL columns.
2. Create `glossary-measure-ref-resolver.ts`:
   - strip leading `business_metrics/` (and any `<dir>/`) from `primaryCatalogId` → catalogId.
   - if `defaultMeasureRef` set → `{ measureRef: defaultMeasureRef, ratioRef: null, refKind: 'measure' }`.
   - else `getById(catalogId)`: measure → `{ measureRef: formula.ref, ratioRef: null, 'measure' }`;
     ratio → `{ measureRef: null, ratioRef: { numerator, denominator }, 'ratio' }`;
     expression → `{ null, null, 'expression' }`; missing → `{ null, null, 'unknown' }`.
3. In `routes/glossary.ts`, after `rows.map(rowToTerm)`, enrich each term via the resolver
   (loader is already boot-loaded). Keep the map a single pass.
4. Build server (`npm --workspace server run build` or repo build script) — no type errors.

## Todo List
- [x] Wire type extended (`measureRef`, `ratioRef`, `refKind`)
- [x] `deriveMeasureRef` pure helper created
- [x] List + by-id endpoints emit the new fields
- [x] Prefix-strip handles `business_metrics/` and bare ids
- [x] Measure → measureRef; ratio → ratioRef{num,den}; expression/missing → null + tagged
- [x] Server compiles

## Success Criteria
- `GET /api/glossary?status=official` returns `revenue` with `measureRef:"recharge.revenue_vnd"`,
  `refKind:"measure"`.
- A ratio term (`rr`) returns `ratioRef:{numerator:"retention.retained_d7",denominator:"retention.cohort_size"}`,
  `refKind:"ratio"`, `measureRef:null`.
- A term whose catalog id has no YAML returns `measureRef:null`, `ratioRef:null`, `refKind:"unknown"`.
- `default_measure_ref` override beats `formula.ref`.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Loader cache cold/empty when glossary served (boot order) | M×H | `index.ts:33` runs `loadAll` before listen; resolver tolerates `getById=undefined` → `refKind:'unknown'` (degrades, never throws) |
| Catalog YAML edited live (dev watcher) but glossary ETag unchanged → stale `measureRef` | M×M | ETag is `MAX(updated_at)` of glossary rows only; catalog edits won't bust it. Accept for dev (chat client TTL 30s); note in Phase 06. Do NOT widen ETag this pass (YAGNI) |
| `primary_catalog_id` prefix variants (`business_metrics/` vs none) | M×M | Strip any `<segment>/` prefix; test both shapes |
| Ratio member missing from /meta (numerator or denominator) | M×H | Phase 02/04 validates BOTH members; if either absent, gate falls back to clarify rather than emitting a half-built ratio query |

## Security Considerations
- Read-only derivation; no new write paths. No PII. No auth change.

## Next Steps
- Phase 02 consumes `measureRef`/`refKind` as the single contract input.
