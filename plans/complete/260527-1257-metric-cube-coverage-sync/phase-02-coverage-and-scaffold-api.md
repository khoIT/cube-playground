# Phase 02 — Coverage + scaffold API endpoints

## Context
- Add to existing `src/routes/business-metrics.ts` (already hosts `GET /api/business-metrics/drift`, `POST /api/business-metrics`, `PATCH .../:id/trust`).
- Reuse phase-01 `metric-coverage-resolver.ts` and the existing atomic create path in `business-metrics-loader` / the POST handler (Zod `BusinessMetricSchema`, `.tmp`+rename write).

## Overview
Priority: high. Status: blocked on phase-01.
Two routes: aggregate coverage (read) + scaffold draft stubs (write).

## Requirements
### GET /api/business-metrics/coverage
- No `game` param → all games via `resolveCoverageAllGames`. Optional `?game=` → single.
- Returns `{ games: MeasureCoverage[], matrix: MatrixCell[], generatedAt }`.
- Fail-open per game (status:'error'); 200 even if some games error. 502 only on total failure.

### POST /api/business-metrics/scaffold
- Body: `{ measures: Array<{ ref: string; game?: string }> }` (ref = `cube.member`).
- For each: derive a draft metric stub and create it via the SAME validated atomic writer as `POST /api/business-metrics`.
- Stub shape (defaults, human curates later):
  ```yaml
  id: <member>            # slug of measure name; collision → suffix _2
  label: <Title Case member>
  description: "Draft — scaffolded from <ref>. Review before promoting."
  tier: 3
  domain: uncategorized
  owner: data-platform@vng
  trust: draft
  formula: { type: measure, ref: <ref> }
  format: compact
  game_compatibility: { required_cubes: [<cube>] }
  ```
- Idempotent: if a metric with that id OR identical `formula.ref` already exists → skip, report `skipped`.
- Response: `{ created: string[], skipped: Array<{ref, reason}> }`.

## Related files
- Modify: `src/routes/business-metrics.ts` (2 handlers).
- Maybe extract stub builder → `src/services/metric-stub-scaffolder.ts` (pure: ref → BusinessMetric) for testability. Reuse loader's create/write fn; do NOT invent a new writer.

## Steps
1. Add `GET /coverage` calling resolver; shape response; fail-open.
2. Add `metric-stub-scaffolder.ts` pure builder + Zod-validate output against `BusinessMetricSchema`.
3. Add `POST /scaffold`: validate body, dedup vs `getAll()` (id + ref), write via existing create fn, reload registry, return created/skipped.

## Success criteria
- Endpoint test: coverage returns games[] + matrix for ≥1 game.
- Scaffold test: posting an uncovered ref writes a valid draft YAML that re-loads (loader picks it up, `trust:draft`); re-posting same ref → skipped.
- Scaffolded stub passes `BusinessMetricSchema` (no manual edit needed to be valid).

## Risks
- id collision with existing metric ids/synonyms — dedup on id AND ref; suffix on id clash.
- Writing into `presets/business-metrics` in prod: gate behind same auth as other write routes (match existing POST). Confirm route auth posture.

## Open questions
- Should scaffold target a separate `drafts/` dir vs main registry? (Default: main registry, `trust:draft` keeps them filtered.) — confirm in phase-04 if UX needs separation.
