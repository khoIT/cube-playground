# Phase 06 — Tests + Docs + Lessons

## Context links
- Overview: [plan.md](plan.md)
- All prior phases (P1-P5)
- Test conventions: existing chat-service + server test suites; `docs/lessons-learned.md`

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: TDD coverage across the new surfaces, docs sync, and a lessons-learned entry. Each prior phase writes its own unit tests; this phase ensures integration + e2e of the rail and closes docs.
- **Blocked by**: P1-P5.

## Key insights
- TDD where possible per phase; this phase is the integration net + the no-fabrication / confirm-gate regression guards (the two invariants most likely to silently rot).
- jus_vn data-gate is the highest-value regression target: a future careless lever edit could leak clan/gacha — lock it with a test.

## Requirements
**Functional (test matrix)**
- **Unit (P1)**: lever-library index withholds jus guild/gacha levers; cheating surfaces as blindSpot; benchmark-resolver rejects external norm lacking source/citation; percentile-snapshot store upsert/read.
- **Unit (P2)**: decompose_metric maps diagnose response; 403→advisor-disabled; deeper passes lenses 5-9.
- **Unit (P3)**: recommend_actions joins citation; care_queue annotates; timeout→ok:false.
- **Unit (P4)**: trust-guard rejects uncited action; relabels blind-spot-as-action.
- **Unit (P5)**: propose_action emits SSE and never calls a write endpoint (assert no fetch to write paths); kind must match defaultWrite.
- **Integration**: rail end-to-end on a mocked diagnose+recommend → cited conclusion + cited actions; jus_vn run contains no clan/gacha action.
- **e2e (manual/scripted)**: cfm_vn revenue-drop full rail incl. confirm card create care case; sweep two-confirm; experiment draft+assign.

**Docs**
- Update `docs/codebase-summary.md` + `docs/system-architecture.md` (new knowledge library + chat rail + outcome loop).
- Update `docs/service-api-surface-map.md` (new `/api/knowledge/levers`).
- Add `docs/lessons-learned.md` entry: confirm-gate invariant + genre data-gate / no-fabrication shape with signal.

## Related code files
**Create**
- Test files alongside each new module (chat-service `*.test.ts`, server `*.test.ts`).
**Modify**
- `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/service-api-surface-map.md`, `docs/lessons-learned.md`

## Implementation steps
1. Author/collect unit tests per phase (P1-P5) — verify they fail pre-impl where TDD applies.
2. Integration test for the rail (mock server-client responses).
3. Manual e2e run on cfm_vn + jus_vn; capture in test notes.
4. Docs sync + lessons entry.

## Todo
- [ ] P1 unit tests (data-gate, blind-spot, benchmark, snapshot)
- [ ] P2-P3 tool unit tests (mapping, citation, error handling)
- [ ] P4 trust-guard tests (uncited reject, blind-spot relabel)
- [ ] P5 no-direct-write test + kind-match test
- [ ] rail integration test
- [ ] manual e2e cfm_vn + jus_vn
- [ ] docs sync + lessons-learned entry

## Success criteria
- All suites green (no skipped/fake-passing). jus data-gate + confirm-gate regression tests present and passing.
- Docs reflect the new surfaces; lessons entry added.

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Flaky tests hitting live Cube | M×M | Mock server-client in tool tests; live only in manual e2e. |
| Confirm-gate regression untested | L×H | Explicit assertion: propose_action makes no write fetch. |

## Security
- Tests must not commit tokens/PII; use fixtures.

## Next steps
- Ship. Forecast-vs-target follow-on can build on the scorecard read seam.
