# Phase 06 — Tests + Docs + Lessons

## Context links
- Overview: [plan.md](plan.md)
- All prior phases (P1-P5)
- Test conventions: existing chat-service + server test suites; `docs/lessons-learned.md`

## Overview
- **Priority**: P1
- **Status**: done (2026-06-19)
- **Description**: TDD coverage across the new surfaces, docs sync, lessons-learned entries, live e2e of the rail. Reflects the P5 descope (no confirm-gated write tests) and folds in the lever data-gate naming fix surfaced during e2e.
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
- ~~**Unit (P5)**: propose_action…~~ DESCOPED — confirm-gated writes removed; the rail ends at cited strategy. Coverage instead asserts the rail proposes strategy framed on segments and emits no write artifact.
- **Unit (data-gate naming tripwire, folded in)**: lever `requiredCubes` resolve against a REAL `/meta` fixture (cfm_vn+jus_vn), not a set derived from the tokens; previously-misnamed FPS/MMORPG levers now resolve; genuine gaps (guild, pending `ladder_level_prev`) stay in a documented `KNOWN_ABSENT` allowlist. (`server/test/genre-lever-library.test.ts`, +4 tests → 21.)
- **Integration**: existing `turn-flow.integration.test.ts` (SDK-mocked) covers SSE ordering/persistence.
- **e2e (live, done)**: cfm_vn prescriptive turn → `advise` door → decompose→recommend, trust guard refused uncited recs, genre blind spots surfaced, ended in data-exploration scope. jus_vn diagnostic turn → `diagnose` door → decompose→benchmark→conclusion (dual-benchmark, honest null internal). Both via real LLM (subscription lane), no clan/gacha leak, no write artifact.

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
- [x] P1 unit tests (data-gate, blind-spot, benchmark, snapshot)
- [x] P2-P3 tool unit tests (mapping, citation, error handling)
- [x] P4 trust-guard tests (uncited reject, blind-spot relabel)
- [x] ~~P5 no-direct-write test~~ → descoped; rail-ends-at-strategy verified live
- [x] data-gate naming tripwire test (real /meta fixture) — folded-in fix
- [x] live e2e cfm_vn (advise) + jus_vn (diagnose)
- [x] lessons-learned entries (data-gate naming drift; dead-server-as-KC-500)

## Folded-in fix — lever data-gate member-name drift
Surfaced during e2e: the advisor reported "missing cubes" for data that exists. Root cause = `requiredCubes` tokens written as SQL column names, not exposed Cube members. Fixed 5 tokens (`clan_cur`→`clan_id`, `ladder_level_cur`→`ladder_level`, `unique_players`→`distinct_players`, `peak_ccu`→`server_peak`, `server_id`→`server`); added `ladder_level_prev` dimension to `cfm/user_gameplay_daily.yml` (unlocks rank-drop after the model deploys to the tunnelled Cube). Verified: 4 cfm + 1 jus levers now resolve against live `/meta`. See lessons-learned.

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
