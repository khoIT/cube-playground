# Phase 2 — Measure→dimension catalog (window-annotated)

## Overview
- **Priority:** P0 (parallel with P1; unblocks measure-threshold + tells chat which
  per-user column to take the percentile/top-N over).
- **Status:** pending.
- A per-game catalog mapping a *measure concept* (spend/revenue) to its per-USER
  dimension on the identity cube, annotated with time window + currency + default
  population. Without it chat cannot reliably rewrite `revenue > 1000` → a dimension
  filter, nor know which column feeds `approx_percentile`.

## Key insights (verified)
- Per-user lifetime dims exist on `mf_users`: `ltv_vnd` = `ingame_total_recharge_value_vnd`,
  `ltv_30d_vnd` = `ingame_total_recharge_value_vnd_30d`, plus `ltv_usd`, `total_active_days`,
  recharge counts (cfm + jus mirror; jus identity merged via `split_part`).
- No mapping exists today. `segment-rank-measure.ts` (`pickSegmentRankMeasure`) can
  *identify* a measure leaf but cannot *rewrite* it to the per-user dim.
- **Window must match:** "spend last 30d > 1000" ≠ `ltv_vnd` (lifetime); only `ltv_30d_vnd`.
  Wrong window = silently wrong segment. Catalog MUST carry `window`.
- Live cube models: `cube-dev/cube/model/cubes/{cfm,jus}/mf_users.yml` (bare per-game,
  local) and prefixed variants on prod — use the member-resolver abstraction, do not
  hardcode physical names.

## Requirements
**Functional**
- Catalog entry: `{ game, concept, cube, dimension, window: 'lifetime'|'30d'|…, currency,
  defaultPopulation: PredicateNode | filterSpec, confidence }`.
- Build path: derive candidates from cube YAML naming convention → write a **blessed**
  checked-in catalog (hybrid: auto-generate, human-confirm). Mirrors `audit:metric-trust`.
- Loader exposed to chat as a tool (`get_segmentable_measures`) or folded into cube meta.
- `defaultPopulation` for spend concepts = payers (`<ltv_dim> > 0`) — encodes the P1 invariant.

**Non-functional**
- Catalog is data, not code logic; keep generator deterministic + re-runnable.
- Unknown concept/window → loader returns `null` (chat must then ask, not guess).

## Architecture
```
cube YAML (mf_users.yml per game)
  → derive-segmentable-measures (scan dims: ltv*, *_30d*, recharge*, active_days)
  → candidate catalog (with inferred window/currency + low confidence)
  → human review → blessed catalog file (checked in)
  → loader (runtime) → chat get_segmentable_measures tool
```

## Related code files
**Create**
- `server/src/services/segmentable-measures-catalog.ts` — types + loader
  (read blessed file, resolve physical dim via member resolver). <200 LOC.
- `server/src/data/segmentable-measures.<game>.json` (or one file keyed by game) — blessed catalog.
- `server/scripts/derive-segmentable-measures.mjs` — generator from cube YAMLs.
- chat tool `chat-service/src/tools/get-segmentable-measures.ts` (Phase 3 registers it).
**Read for context**
- `cube-dev/cube/model/cubes/{cfm,jus}/mf_users.yml`, `server/src/services/segment-rank-measure.ts`,
  member-resolver (workspace abstraction).

## Implementation steps
1. Define catalog type + write `derive-segmentable-measures.mjs` (regex dims, infer
   window from `_30d`/none→lifetime, currency from `_vnd`/`_usd`).
2. Run generator for cfm_vn + jus_vn; hand-review; commit blessed JSON.
3. `segmentable-measures-catalog.ts` loader — resolve physical member per workspace,
   return entries incl. `defaultPopulation`.
4. Seed concepts: `spend` (ltv_vnd lifetime, ltv_30d_vnd 30d), `spend_usd`, `active_days`.

## Todo
- [ ] catalog type + generator script
- [ ] generate + bless cfm_vn / jus_vn entries
- [ ] loader with member-resolver
- [ ] default population (payers) per spend concept
- [ ] unit test: loader returns correct dim+window+population; unknown→null

## Success criteria
- `getSegmentableMeasures('cfm_vn')` returns spend→{dimension: ltv_vnd, window: lifetime,
  defaultPopulation: ltv_vnd>0} and the 30d variant.
- Generator re-run produces no diff against blessed file for unchanged models.

## Risk assessment
- Naming convention not airtight (per-game drift) → low-confidence inferences. Mitigate:
  blessed file is source of truth; generator only proposes.
- jus merged identity: the per-user dim value must reflect merged rows; catalog flags
  jus spend dims as `requiresIdentityMerge: true` so P1's cutoff query uses the merged form.

## Security
- Catalog is an allowlist — only listed dims are valid `over.column` targets for
  `/resolve-cutoff`, closing the SQL-injection surface from Phase 1.

## Next steps
- Phase 3 chat tool reads this to build correct `over` + population.
