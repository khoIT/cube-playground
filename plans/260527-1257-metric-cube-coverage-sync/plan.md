# Metric ↔ Cube coverage monitor + draft scaffolding

## Goal
A service + Settings UI that reconciles the **business-metrics registry** (`server/src/presets/business-metrics/*.yml`, curated metrics) against the **cube-dev data model** (live per-game Cube `/meta`). Surface where the two diverge ("gaps") and let a human scaffold draft metric stubs for uncovered cube measures.

Two YAML layers are NOT 1:1 — cube-dev defines raw measures; our registry holds curated metrics (tier/trust/owner/synonyms). So "sync" = **detect + scaffold draft stubs for curation**, never blind copy.

## Gap types to surface (all three)
1. **Broken refs** — registry metric whose `formula.ref` doesn't resolve in a game's `/meta`. (reuse `validateRefs` / `getDrift`)
2. **Uncovered measures** — `/meta` measures referenced by no metric → scaffold candidates.
3. **Per-game availability matrix** — metric × game grid: resolves / broken / cube-missing.

## Sync semantics (chosen)
Read-only detection + **scaffold draft stubs**: for selected uncovered measures, generate `trust: draft` metric YAMLs (via existing atomic writer) for a human to curate. No auto-repoint.

## Reuse (already exists)
- `metric-ref-validator.ts` — `snapshotFromMeta`, `validateRefs`.
- `metric-trust-resolver.ts` — `getDrift(metrics, gameId)`.
- `GET /api/business-metrics/drift?game=X` route + `POST /api/business-metrics` (atomic create).
- `resolve-cube-token.ts` (per-game token), `cube-client.getMeta`, `games-config-loader`.
- CLI `check-metric-drift.ts` (per-game report shape: cubesInMeta/membersInMeta/unresolved[]).
- Settings UI pattern: `src/pages/Settings/*-section.tsx` + `section-card.tsx` + tokens.

## Phases — ALL COMPLETE (2026-05-27)
- [x] **phase-01** — `metric-coverage-resolver.ts` + `snapshotFromMeta` measures set. Tests: `metric-coverage-resolver.test.ts`.
- [x] **phase-02** — `GET /coverage` + `POST /scaffold` + `metric-stub-scaffolder.ts`. Tests: coverage + scaffold endpoint + scaffolder.
- [x] **phase-03** — `metric-coverage-section.tsx` + `metric-coverage-matrix.tsx` + `use-metric-coverage.ts`; registered in `settings-page.tsx`.
- [x] **phase-04** — scaffold action wired + UI test + docs (changelog) updated. Server 295 / web 1441 green. Endpoints live-verified on :3000.

## Key dependencies
- Per-game `/meta` fetch is network-bound + async ("Continue wait") — cache snapshot per request, fail-open like `getDrift`.
- Scaffold writer must reuse the existing Zod-validated atomic create path (no new write mechanism).

## Out of scope
- Auto-repoint of broken refs. Concurrency metrics (no source). cube-dev model edits (separate repo). ptg/muaw infra gap.
