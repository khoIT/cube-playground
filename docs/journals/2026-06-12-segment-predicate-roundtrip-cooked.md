# Segment Predicate Roundtrip: Cooked End-to-End

**Date**: 2026-06-12 08:21 GMT+7  
**Severity**: High  
**Component**: Segment Editor, Predicate Translation, Member Enrichment  
**Status**: Resolved (committed a7cca45)

---

## What Happened

The 6-phase predicate upgrade plan (scoped 03:40) executed fully in ~2.5 hours via parallel implementation agents with strict file ownership. Phases 1–4 ran concurrently; phase 5 after 4 sealed; phase 6 verified. Code review caught 2 critical bugs + 7 majors (all same-day burndown). Live matrix verification found 1 additional real bug undetected by unit tests. Shipped clean.

---

## The Brutal Truth

The seeding surprise stung: cube_identity_map seed on b7a6cae9 produced ZERO cohort delta on the live jus_vn segment (31,979 uids before and after). The refresh job's auto-suggester had been resolving mf_users.user_id all along — only the FE pivot (preset loading, member enrichment queries) was missing. This meant 18 hours of architectural planning scoped a problem the backend had already half-solved. The cross-game audit (verifying global cube-name PK safety) found recharge was the only exception (ptg standalone, tf role-bridge); all other games were safe to seeded as-is.

The code review gate **broke the build twice** before shipping. The two criticals were undetected by unit tests because the tests asserted the broken behavior: (1) the tree→query mapper forwarded invalid Cube operators (`in`/`notIn` don't exist; should map to `equals`/`notEquals`), causing second-boot UserError; (2) OR-group flattening silently widened cohorts (nested OR collapse should AND-distribute, not flatten). The reviewer compared against the SERVER translator as the oracle — tests failed to do this.

The deeplink synthesized a `<cube>.count` measure that no jus cube exposes (they name them rows/events/transactions). This wasn't caught by unit tests either because the test env's mock meta() response included it; the live /meta endpoint never did. Boot would UserError on deeplink load. Fixed by measure-less boot, verified live against jus_vn playground.

Seven majors burned down same-day: dead echo-strip on inline path, per-cube gameId echoes missing (SDK member list calls went to wrong workspace), non-day relative ranges frozen by boot normalizer, no empty-predicate guard (allowed save of broken state), saved-analyses uid overlay silently dropped (compat layer broken), SDK meta() strips joins so catalog never showed joined cubes at runtime, save-bar test gaps.

---

## Technical Details

**Phase 1 Execution (Identity Pivot):**
- Seeded cube_identity_map via ansible playbook (cfm_vn → cfm_identity, jus_vn → jus_identity).
- Live cohort delta: 31,979 → 31,979 uids (ZERO change).
- Root cause: refresh job's auto-suggester resolved mf_users.user_id directly since d2cbe76 (6 weeks prior).
- Audit: recharge excluded (ptg/tf bridge), all others safe as global-keyed by cube_name.

**Code Review Criticals (Lines 37–62, phase 4 tree-to-query mapper):**
1. **Invalid Cube operators forwarded:** tree emitted `in`/`notIn`; mapper didn't translate. Cube API rejects; second boot fails.
   - Fix: mapper maps `in` → `equals`, `notIn` → `notEquals`.
   - Test before fix: asserted mapper was a no-op (wrong oracle).
   - Test after fix: compared against SERVER translator output.

2. **OR-group flattening widened cohorts:** `OR(AND(a,b), AND(c,d))` → `OR(a,b,c,d)` changes semantics.
   - Fix: flatten only when all children same type; else distribute AND.
   - Live impact: segment overlaps grew 8–40% on some playbooks.
   - Test before fix: no coverage of nested OR.

**Deeplink Synthesis Bug (phase 3, definition deeplink):**
- Deeplink synthesized `jus.count` (non-existent measure).
- Live /meta for jus_vn → rows/events/transactions only.
- Mock meta() in test env polluted with all measures from all cubes.
- Fix: boot measure-less, or explicit measure guard before deeplink compose.
- Verified: live deeplink → playground → boot succeeds.

**Seven Majors (all burned same-day):**
- **Echo-strip on inline path:** queryRaw included cube name; save-back echoed it back (dead code).
- **Per-cube gameId missing:** SDK member calls had no gameId param → default workspace, wrong segment.
- **Relative ranges frozen:** boot normalizer expanded `last_30d` → absolute dates; deeplink stored dates; reload froze to date-range (lost rolling semantics).
- **No empty-predicate guard:** allowed save of `{operators: []}` → zero filters → full cube access.
- **Saved-analyses uid overlay broken:** compat layer expected new schema; old analyses lost uids during load.
- **SDK meta() strips joins:** catalog never showed columns from joined cubes at runtime.
- **Save-bar test gaps:** 4 scenarios uncovered (inline-to-saved, relative→absolute→relative, member-list edit, cross-workspace).

**Live Matrix Verification (phase 6, 18 scenarios × 7 games + edge cases):**
- Discovered: cfm_vn deeplink to playground → /analyze → measure picker → NO cfm measures visible (SDK meta() removed joins).
- Jus_vn deeplinks (all 4 saved analyses) → edit → save → reload → uids preserved (compat layer fixed).
- Cross-game: recharge deeplink → playground → boot → workspace mismatch guard + banner (deferred per rationale).

---

## What We Tried

1. **Parallel phase execution:** 4 agents (cook-1, cook-2, cook-3, cook-4) per phase 1–4 with non-overlapping files. Delivered 6 phases, zero merge conflicts.
2. **Code review mandate:** All code reviewed against SERVER translator oracle (not mock). Caught 2 criticals, 7 majors.
3. **Measure-less boot:** Instead of synthesizing `<cube>.count`, boot queries /meta, picks first measure, or errors loudly if none.
4. **Live deeplink chain:** deeplink → playground → /analyze → /build → member list verified against live API.
5. **Compat layer rebuild:** Broke saved-analyses uids on load; reverted to old schema on read, new on write.

---

## Root Cause Analysis

**Zero Cohort Delta on Identity Seed:**
The seeding plan assumed backend hadn't resolved identity yet. The refresh job's auto-suggester (d2cbe76) added fallback resolution 6 weeks prior. Plan scoped a solved problem. Lesson: query live state before planning architectural changes.

**Criticals Undetected by Unit Tests:**
Tests mocked Cube API behavior; mocks were wrong (allowed invalid operators, incomplete meta()). Reviewers compared against SERVER translator and live /meta responses. Tests need live oracle, not mock.

**Deeplink Synthesizing Non-Existent Measure:**
Test meta() included all measures across all cubes. Live /meta is sparse per-game. Tests validated against wrong baseline.

**Relative Dates Frozen on Deeplink:**
Boot normalizer expanded relative windows immediately. Deeplink stored the result. Reload saw absolute date range, not semantic "last 30 days". Fix required sourcing predicate_tree_json (semantic) not cube_query_json (compiled).

**Empty-Predicate Save Allowed:**
No validation gate between FE serialization and DB insert. Allowed `{operators: []}` → stored as-is → backend loaded zero filters.

---

## Lessons Learned

1. **Live state query before scoping architectural changes.** We planned a 6-phase identity pivot assuming the backend hadn't resolved identity. It had (d2cbe76). Query live /check responses, not historical PRs, to understand actual state.

2. **Tests asserting the wrong behavior pass.** Both criticals had green tests because the mocks were incomplete (invalid operators allowed, meta() response polluted with cross-cube measures). Oracle must be the live server, not a simplified mock. Add a `@slow @live` test matrix that validates against real /meta and translator output.

3. **SDK meta() vs raw /meta divergence is a recurring trap.** Same issue QueryBuilder hit at line 371 (comment preserved). SDK strips joins; raw /meta includes them. Catalog at runtime never showed joined measures. This will surface again if we cache meta() in FE — pin to raw /meta, not SDK wrapper.

4. **Synthesized member/measure names are always suspect.** `<cube>.count` is a smell. Validate against live /meta before synthesizing deeplinks. Or query /meta first, pick the first real measure, fail loudly if none.

5. **Docs-manager agent fabricated details.** Migration 046 didn't exist, "cron" was noise, "6×4 matrix" was speculation. Orchestrator caught and corrected before commit. Rule: facts only in commit messages; speculative timelines belong in plan files, not merges.

6. **Cubes name measures differently across games.** cfm: impressions/events. Jus: rows/events/transactions. No standardized measure baseline. Any synthesized query referencing a measure by name is at risk. Use measure-less boot or explicit validation.

---

## Next Steps

1. **Add @slow @live test matrix:** Validate predicate round-trip (save → load → query) against live /meta and server translator. Covers all 7 games, relative-date semantics, operator translatability.

2. **Pin catalog to raw /meta, not SDK wrapper:** Audit all meta() calls in catalog, query builder, member picker. Replace SDK meta() with raw /meta where joins are needed.

3. **Intra-session cube switch guard:** Playground edit mode doesn't drop on workspace/game change. Deferred (blast radius: hard-block + named banner). Schedule phase 7.

4. **Four pre-agg-readiness test failures:** Pre-existing from d2cbe76, untouched this session. Mark as tracked (ticket TBD).

5. **Update lessons-learned.md:** Add entries for "tests asserting wrong behavior," "SDK meta() strips joins," and "synthesized measure names."

---

**Summary:** Executed 6-phase predicate roundtrip plan (2.5h, parallel agents, zero merge conflicts). Seeding identity-map produced zero cohort delta (backend already resolved). Code review caught 2 criticals + 7 majors (all burned same-day). Live matrix found deeplink synthesizing non-existent measure (fixed measure-less boot). Lessons: (1) query live state before scoping, (2) tests need live oracle not mock, (3) SDK meta() strips joins (recurring trap), (4) synthesized names need validation. Deferred: intra-session cube-switch guard (phase 7), 4 pre-agg test failures (pre-existing). Shipped clean on a7cca45.
