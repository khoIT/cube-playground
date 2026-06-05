# Phase 05 — Tests Sweep + Docs

## Context Links
- Plan: [plan.md](plan.md)
- Depends on: phases 01-04 (tests the final code)
- chat-service test pattern: `chat-service/test/db/*.test.ts` — `new Database(':memory:')` + `migrate(db)`; `vi.mock('../../src/config.js', ...)`
- FE test pattern: `src/pages/Chat/__tests__/starter-library-grid.test.tsx`, `persona-histogram.test.ts`
- Docs to sync: `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/service-api-surface-map.md` (if present), `docs/lessons-learned.md`

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Unit + integration tests for the chat-service generation stack and the FE hook/components, plus docs sync. NO mocks of the DB (use real `:memory:`). LLM is dependency-injected so the refiner is tested with a fake `callLlm`.

## Key Insights
- chat-service tests MUST run from the chat-service dir (`cd chat-service && npx vitest run`); repo-root vitest targets the FE.
- The refiner takes `callLlm` as a dep (mirroring `summariseTitle`) → tests inject a fake returning fixed JSON; no network, no real model.
- Use real meta fixtures: one local (bare members), one prefixed (prod-style) to prove suffix matching + member validation across both workspace models.
- ESM env trap (lessons-learned): never set `process.env` at module top before importing the store — use `vi.mock('../../src/config.js')` like existing tests.

## Requirements — chat-service tests
1. `test/db/starter-questions-store.test.ts`: migrate idempotent; upsert→get round-trip; `tryAcquireRefineLease` returns false on a live lease, true when free or expired; release frees it.
2. `test/core/starter-question-templates.test.ts`: local fixture → ≥3 questions, every `targetCatalogIds` ∈ fixture members; prefixed fixture → suffix match still fires templates; sparse fixture → fewer, never throws, never invents; persona/category tags within allowed unions.
3. `test/core/starter-question-refiner.test.ts`: valid LLM JSON → upsert `source:'llm'`; LLM with an invented member → whole set rejected, baseline kept; malformed/ fenced JSON → reject; single-flight (lease held) → second schedule is a no-op (callLlm not called twice).
4. `test/core/starter-question-service.test.ts`: cold → template + schedule; fresh-hash row → served, no regen; stale row → old served + regen scheduled; meta-fetch throw with row → row served; <3 template questions + no row → `static-fallback`.

## Requirements — FE tests
5. `src/pages/Chat/__tests__/use-generated-starters.test.tsx`: mock fetch → generated set returned; empty/`static-fallback`/fetch-error → falls back to `STARTER_QUESTIONS`; re-fetch on game change.
6. `src/pages/Chat/__tests__/starter-shape-contract.test.ts`: assert server response items and FE `StarterQuestion` share field names (the cross-boundary contract guard called out in phase-01) — lightweight type-shape check.
7. Update `starter-library-grid.test.tsx` only if the grid prop contract changed (it does NOT — grid still takes `starters` array). Likely no change.

## Requirements — docs
- `docs/codebase-summary.md`: note the per-game starter generation stack (table, route, hook).
- `docs/system-architecture.md`: add the generation data flow (template + async LLM, stale-while-revalidate).
- `docs/service-api-surface-map.md` (if it exists): add `GET /api/chat/starter-questions` + proxy.
- `docs/lessons-learned.md`: ADD an entry IF a new bug-shape emerges during build (e.g. "generated starter referencing a member that exists in meta but greyed out in builder" — mirrors the views lesson). Only add if real.

## Implementation Steps
1. Write chat-service tests (4 files) using `:memory:` + `migrate` + injected `callLlm`.
2. Run `cd chat-service && npx vitest run` — all green.
3. Write FE tests (2 files) with mocked fetch.
4. Run repo-root `npx vitest run` for the Chat suite — all green.
5. Sync the docs listed above.

## Todo List
- [ ] `starter-questions-store.test.ts`
- [ ] `starter-question-templates.test.ts` (local + prefixed + sparse fixtures)
- [ ] `starter-question-refiner.test.ts` (valid / invented-member / malformed / single-flight)
- [ ] `starter-question-service.test.ts` (cold / fresh / stale / meta-fail / fallback)
- [ ] `use-generated-starters.test.tsx` (generated / fallback / re-fetch)
- [ ] `starter-shape-contract.test.ts`
- [ ] chat-service vitest green; FE vitest green
- [ ] docs synced (codebase-summary, system-architecture, api-surface-map)

## Success Criteria
- `cd chat-service && npx vitest run` → all green, no skips.
- Repo-root `npx vitest run` Chat suite → all green.
- No DB mocks; refiner tested with injected fake `callLlm`; no network in tests.
- Docs reflect the new endpoint + flow.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| ESM env hoist wipes dev db (lessons-learned) | M×H | Use `vi.mock('config')` + `:memory:`; never top-level `process.env=` before import |
| Flaky single-flight test (timing) | M×M | Test lease via store state, not wall-clock sleeps; expire by setting `inflight_until` in the past |
| FE fetch mock leaks across tests | L×M | Reset mocks in `beforeEach`; reset prefs cache per global setup (existing `test-setup.ts`) |

## Security Considerations
- Tests assert no PII/owner stored in `starter_question_sets` (rows are workspace+game only).

## Next Steps
- Feature complete. Do NOT push git (per constraints). Hand back to controller for review/ship.
