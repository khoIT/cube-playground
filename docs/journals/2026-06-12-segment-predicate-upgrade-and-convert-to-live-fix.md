# Segment Predicate Upgrade Plan & Convert-to-Live Type Bug

**Date**: 2026-06-12 03:40 GMT+7  
**Severity**: High  
**Component**: Segment Editor, Predicate Translation, Member Enrichment  
**Status**: Plan Created, Bug Fixed, Red-Team Resolved

---

## What Happened

Two parallel discoveries converged: a critical convert-to-live bug where segment type was silently lost during mutation, and a deeper realization that the segment member enrichment pipeline silently orphans cohorts when cubes lack the right metadata. A comprehensive upgrade plan (6-phase, 19 findings, 3 critical) was created to unify predicate storage, enable member-list enrichment, and close 18 months of post-hoc deeplink debt.

---

## The Brutal Truth

The convert-to-live bug was an absolute gut-punch because the UX lied. Users saw "Segment updated" toast and the UI _appeared_ to accept the transition, but the database still held `type: 'manual'`. The auto-refresh mechanism checked the stale row, so the UI stayed in manual mode even after clicking convert-to-live. This stayed broken until a regression test actually tried it end-to-end.

The member enrichment orphaning (no columns in auto-generated preset) is worse because it's silent. A segment built on `active_daily` in a game missing that cube's curated identity preset just gets an empty memberColumns preset, enrichment queries never fire, and the user sees uid-only list. No error. No warning. Just dead data that looks alive.

The red-team findings exposed architecture debt we've been ignoring: global-keyed config tables (cube_identity_map) will silently rebind identities when seeding across 7 copies of active_daily in different games. Store-then-deeplink breaks relative dates. Silent operator-drop in translators could widen cohorts. All three bite hard if we scale deeplinks naively.

---

## Technical Details

**Convert-to-Live Bug (aad460a):**
- `segmentPatchSchema` excluded `type` field from mutation payload
- UPDATE query never wrote type column
- Stale row with `type: 'manual'` remained in database
- Auto-refresh gate (refresh.ts) checked old row type before querying new predicate
- Manifest: users could see "updated" but segment stayed manual; clicking edit showed manual UI; calling /check?type=predicate returned 400

**Member Enrichment Orphaning:**
- Cube without curated preset (e.g., cfm_vn missing active_daily curated view) → auto-generates preset with NO memberColumns
- use-member-dim-rows gate checks preset, finds empty list, skips enrichment queries
- Manifest: member tab shows uids only; re-query returns same uids + no enrichment data; no error, silently incomplete

**Cube Sidecar Verification:**
- Confirmed segments:["active_daily.last_30d"] in cube_query_json IS honored by refresh size+uid queries (refresh-segment.ts:157)
- Deeplink consumer (?from-segment=) is dead code with no callsites — any >8000-char uid deeplink opens empty /build

**Critical Red-Team Findings (all folded into plan):**
1. **Global PK collision (C1):** cube_identity_map cube name is literal global PK. active_daily exists in 7 games. Naive seeding rebinds cfm vopenid identity across all 7. Fix: namespace by workspace in sidecar.
2. **Relative-date loss (C2):** cube_query_json stores dates pre-expanded. Round-trip deeplink would freeze rolling windows. Fix: source predicate_tree_json for deeplink, not expanded dates.
3. **Silent operator-drop (C3):** buildPredicateFromRows nulls unsupported ops (e.g., NOT EXISTS in some cubes). Zero-edit round-trip could widen cohort. Fix: explicit translatability gate before save.

---

## What We Tried

1. **Incremental patch (convert-to-live):** Added type to schema, gated by administer role, persisted correctly, refresh judged vs new type, 400 on missing tree. 4 new regression tests added; all 40 adjacent suites pass.
2. **Root-cause on enrichment:** Traced enrichment gate to missing memberColumns preset. Can't fix without identity-cube resolution (needs workspace isolation, blocked by plan phase 1).
3. **Red-team scenario walk-through:** Modeled C1, C2, C3 across real multitenancy (cfm_vn → 7 game models). Identified that deeplink must source predicate_tree_json, not cube_query_json.

---

## Root Cause Analysis

**Convert-to-Live Type Loss:**
The schema definition was authored without type field visibility. No schema validation during mutation. No post-save verification that persisted row matched intent. Test coverage only checked happy-path, not stale-type scenarios.

**Member Enrichment Orphaning:**
The auto-preset-generation logic was written for single-game, single-cube context. No validation that the target cube exists in the workspace or has curated metadata. No fallback or warning when memberColumns is empty.

**Architecture Debt (Global PKs, Date Freezing, Operator Drop):**
18 months of point-fixes (cube-sidecar, member enrichment, deeplinks) were added without unified spec. Each was "the minimum to ship"; none anticipated multitenancy or round-trip durability. The red team found that implicit assumptions (cube_identity_map is game-local, dates auto-refresh, operators always translate) break at scale.

---

## Lessons Learned

1. **Schema mutations need write-through validation.** After patching type, added post-INSERT SELECT to verify row matches intent before returning 200. Not just "query ran"; verify _state_.

2. **Silent empty results are worse than loud errors.** The enrichment orphaning could have been caught with a simple health check: "if preset exists but memberColumns is empty, log WARNING". Zero friction, high signal.

3. **Global-keyed config tables don't scale multi-game.** cube_identity_map should be keyed by (workspace, cube_name), not just cube_name. Same lesson applies to any shared config table across N game models.

4. **Store-then-deeplink loses semantics.** Dates pre-expanded in cube_query_json can't round-trip rolling windows. Future deeplinks must source predicate_tree_json (the user's intent), not cube_query_json (the compiled query).

5. **Translator edge cases need gates, not silent drops.** buildPredicateFromRows silently nulls unsupported operators. Before enabling round-trip (save deeplink → re-load segment), gate on translatability: "can this predicate survive the translator?" If not, block or warn.

6. **Red-team early on architectural debt.** The 19 findings were all discoverable by walking multitenancy scenarios on paper. We should have done this before shipping the first predicate upgrade feature. Next architectural lift: involve red-team in scoping, not just shipping.

---

## Next Steps

**Immediate (Bug Fix, Completed):**
- Merge convert-to-live type fix (aad460a) with regression tests ✅

**Short-term (Plan Phase 1-2, Blocking Enrichment):**
- Phase 1: Identity pivot sweep — namespace cube_identity_map by workspace, seed active_daily curated preset for cfm_vn, jus_vn games
- Phase 2: Meta-driven member picker — resolve cube_name → identity cube via workspace config, pre-validate memberColumns before queries

**Medium-term (Plan Phases 3-4, UI Unification):**
- Phase 3: Sidecar chips — display segments:[] in query builder, gate deeplinks on translatability
- Phase 4: Definition deeplink — source predicate_tree_json for re-load, freeze relative dates during deeplink edit

**Long-term (Plan Phases 5-6, Cleanup):**
- Phase 5: Playground save-back — enable segment define→test→save round-trip in /build
- Phase 6: E2E matrix — 18-scenario coverage (7 games × 2 cu types + identity-map rebind + operator-unsupported + date-freeze)

**Owner:** Khôi (lead); identity pivot = blocking all phases.  
**Timeline:** Phase 1 completes → unblocks phases 2–4 in parallel; phase 5 unblocked by 3; phase 6 follows 5.

---

**Status:** DONE

**Summary:** Fixed convert-to-live type bug (type in schema, persist verification, 4 regressions); diagnosed member enrichment orphaning (missing memberColumns in auto preset); created 6-phase predicate upgrade plan with 19 red-team findings (3 critical: global-key collision, date-freeze on deeplink, silent operator-drop); all 3 critical resolved in plan scoping.
