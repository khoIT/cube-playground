# Phase 5 — Tests, docs, lessons-learned

## Overview
- **Priority:** P2 (runs alongside / after 1–4).
- **Status:** pending.
- End-to-end verification, doc updates, and a lessons-learned entry so the
  population-scoping correctness trap is not rediscovered.

## Requirements
**Tests**
- Server (Phase 1): cutoff resolver (collect/resolve/scope-required), translate-with-map,
  refresh re-resolves (rolling) — fixture where data shift moves the cutoff. `/resolve-cutoff`
  returns cutoff+count; rejects unscoped.
- Catalog (Phase 2): loader returns dim+window+population; unknown→null; generator idempotent.
- chat (Phase 3): translator reject paths (measure/order-limit/OR-time); 3 hard-case
  builders; propose emits proposal, never writes; unscoped→asks.
- FE (Phase 4): card renders proposal; Create POSTs correct body + tags; estCount shown
  not sample; open-in-editor prefill.
- Integration: live-ish run against cfm_vn/jus_vn cutoffs (744k / 7.08M) — assert
  proposal numbers within tolerance of the measured values.

**Docs**
- `docs/system-architecture.md` — add the chat→propose→FE-write flow + rolling two-pass.
- `docs/codebase-summary.md` — new files (cutoff resolver, catalog, propose tool, card).
- `docs/lessons-learned.md` — entry: "spend percentile/top-N over full mf_users
  degenerates to 0 (free players); always population-scope (payers); cutoff query and
  membership query must share the population." Signal + short-circuit.
- `docs/service-api-surface-map.md` — `/api/segments/resolve-cutoff`.

**Memory**
- Add a project memory pointer for this feature + the population-scoping invariant
  (link to existing segment / chat memories).

## Implementation steps
1. Unit tests per phase (delegate to `tester` after each phase, not just at end).
2. Integration test hitting Trino cutoffs (gated/skippable when offline — mirror existing
   cube-dependent test gating).
3. Docs updates via `docs-manager`.
4. lessons-learned entry + memory file.

## Todo
- [ ] server unit tests (cutoff, translate, refresh-rolling, endpoint)
- [ ] catalog tests
- [ ] chat tests (translator rejects, builders, propose-no-write)
- [ ] FE card tests
- [ ] integration test vs measured cutoffs
- [ ] docs: architecture, codebase-summary, api-surface-map
- [ ] lessons-learned entry (population-scoping trap)
- [ ] memory pointer

## Success criteria
- All suites green; no skipped tests masking failures.
- Re-running the percentile timing harness still ≤5s (regression guard on the budget claim).
- Docs reflect the shipped surface; lessons entry present.

## Risk assessment
- Trino-dependent tests flaky offline → gate behind an env flag, document the skip
  (no silent truncation of coverage).

## Next steps
- Feature complete. Future: extend catalog to more games; consider rank-boundary
  resolver only if "exact frozen top-N" is later requested (out of scope — Q2=rolling).
