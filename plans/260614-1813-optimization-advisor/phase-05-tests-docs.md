# Phase 05 — Tests + docs

## Overview
- **Priority:** P1.
- **Status:** pending.
- Test the predicate-engine extension, the lens engine, prioritization, and the full
  Explore→Recommend→Drive→Learn loop; document the Advisor in `docs/`.

## Requirements
Functional (tests):
1. **Predicate engine (Phase 0):**
   - percentile compile: "top-quartile lifetime_vnd over cfm_vn payers" → member list min-LTV ≈ population P75.
   - derived-date compile: deterministic absolute range given a fixed `asOf`.
   - shared resolver: Care percentile path unchanged (no regression in `server/test` Care suite).
   - **PII allow-list regression:** grep new readers/compilers — no contact columns selected.
2. **Lens engine (Phase 1):** synthesis confidence = # agreeing lenses; sync set returns without lenses 5–9; provenance link present on every lens.
3. **Prioritization (Phase 2):** ranker deterministic given inputs; underpowered segment flagged; every prior labeled with source; LLM pass never reorders.
4. **Hand-off (Phase 4):** accept → **draft** (never launched); draft cohort N ≈ diagnosis N; learn-back idempotent + append-only; dismiss suppresses next diagnosis.
5. **UI (Phase 3/4):** Playwright pageerror==0 on Diagnosis, Peer Studio, Recommendations; peer-axis toggle recomputes; predicate panel shows three classes; design cross-check passes.

Non-functional: tests use real Trino/Cube where the existing suites do (no fabricated data — follow project rules); reproducible via fixed `asOf`.

## Related code files
Create: `server/test/advisor-predicate-engine.test.ts`, `advisor-lens-engine.test.ts`, `advisor-prioritization.test.ts`, `advisor-handoff.test.ts`; `src/pages/Advisor/__tests__/*.test.tsx`.
Modify/update docs: `docs/system-architecture.md` (Advisor decision rail vs command-center execution rail), `docs/codebase-summary.md` (new `server/src/advisor/` + `src/pages/Advisor/`), `docs/service-api-surface-map.md` (advisor routes), `docs/project-changelog.md`, `docs/lessons-learned.md` (if any bug-shape emerges, esp. percentile population scoping).

## Implementation steps
1. Predicate-engine tests first (foundation must be solid).
2. Lens + prioritization tests.
3. Hand-off + loop tests (draft-not-launch is a hard assertion).
4. UI Playwright + design cross-check.
5. Docs sync; update memory if a durable fact emerges (e.g. percentile-predicate engine now exists).

## Todo
- [ ] predicate-engine tests (percentile, derived-date, Care no-regression, PII allow-list)
- [ ] lens-engine tests (synthesis, sync/lazy, provenance)
- [ ] prioritization tests (deterministic, underpowered flag, labeled priors)
- [ ] hand-off tests (draft-not-launch, N match, learn-back idempotent, dismiss)
- [ ] UI Playwright (3 screens, recompute, 3-class panel) + design cross-check
- [ ] docs sync (architecture / codebase-summary / api-surface / changelog)

## Success criteria
- All suites green; no fabricated data; cold-Trino tests gated as the existing suites are.
- Docs describe the decision-rail↔execution-rail split and the Explore↔Hand-off spectrum.
- A memory entry records that the Segments predicate engine now supports derived-date + percentile (closes the verified gap), with file refs.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Cold-Trino flakiness in CI | M×M | gate live-Trino tests as existing suites do; unit-test compilers with fixtures. |
| Draft-not-launch assertion missed | L×H | explicit test asserting status=draft after hand-off. |

## Security (PII)
The PII allow-list regression is a required test, not optional — covers every new reader/compiler.

## Next steps
v2 upgrades (out of scope): model-predicted potential (D) once the Library can train it; non-CS actuators as they come online (open Q#2); precomputed lens cache if Q#5 cost bites.
