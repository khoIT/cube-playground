# Cube Model Onboarding Agent Shipped — Bootstrap Stage Complete, 2 RBAC Bypasses Found in Review

**Date**: 2026-05-30 21:30
**Severity**: High (bypasses fixed pre-ship)
**Component**: DA onboarding agent, Trino introspection, YAML generator, approval gate, `/data` hub
**Status**: Resolved

## What Happened

Completed 8-phase implementation of the Data Analyst onboarding agent (bootstrap stage of bootstrap→reconcile→repair lifecycle). Agent introspects raw Trino schema, profiles columns, infers Cube-model skeleton (dimensions, measures, time grains, PKs, foreign keys + confidence scores), triages decisions via 3-view canvas (queue+YAML, entity-graph, conversational), then stages draft YAML to disk pending reviewer approval before atomically writing to cube-dev. Surfaced at `/data` as Data Hub with connector registry.

All 442 server tests pass green. Code review caught 2 critical RBAC bypasses (grant scope, state precondition) before merge — both fixed + regression-tested. Live integration test of Trino introspection against staging warehouse successful. Pipeline end-to-end: 18s schema fetch → 3s profile → 12s LLM inference → instant triage UI → 1s atomic write.

## The Brutal Truth

This is incredibly frustrating because we shipped everything correctly according to the plan *until the code review*, and then the reviewer's first two findings were real security gates we had completely missed. The painful part is the tests didn't catch them — both were routing/state bugs where a user with editor role on Game A could mutate Game B's drafts, and where a rejected draft could bypass the staging buffer entirely and write straight to disk.

The embarrassing reality: we have a documented "game gate trap" pattern (every headerless route must re-check game grant), and we *knew* the staging gate had a precondition (accepted state before approve), but neither was enforced in code. We tested the happy path (editor → accept → approve → write). We didn't test the attack path (editor + game boundary skip, or pending draft → approve skips acceptance state).

What makes this particularly painful is that we're the *first* direct warehouse access in the playground — new credential surface, new scope vector — and we nearly shipped a 0-day. The fix was trivial (3 lines), but the miss was loud.

## Technical Details

**Bug 1 — Game Grant Bypass in Draft Accept/Reject**
- Route: `POST /data/connector/{id}/draft/{draftId}/accept` and reject.
- Bug: Extracted `game` from draft row and ran the triage business logic, but **skipped the `user.allowsGame(game)` grant check** that the documented "game gate trap" requires.
- Attack: Editor on Game A could POST to `/data/connector/X/draft/123/accept` where draft 123 belongs to Game B. No 403. Mutation succeeds.
- Tests didn't catch: All test triage operations ran on self-granted game (test user always has access to test game).
- Fix: Added explicit `guardGameAccess(user, draft.game, 'game_edit')` before state transition (3 lines).
- Regression test: New test with `game_mismatch: true` verifies 403 reject on cross-game edit.

**Bug 2 — Approve Missing `accepted` State Precondition**
- Route: `POST /data/connector/{id}/draft/{draftId}/approve`
- Bug: Approved any draft regardless of current state. Expected flow is `pending → accept → approved → write`. But a draft in `pending` or `rejected` state could be sent directly to approve, collapsing the staging gate entirely.
- Attack: Editor could skip triage review and force-write rejected/pending draft to cube-dev YAML.
- Tests didn't catch: All approve tests ran on `accepted` drafts (the only valid path in the happy-path suite).
- Fix: Added state precondition `if (draft.state !== 'accepted') throw 403('draft_not_accepted')` (2 lines).
- Regression test: New test `ApproveRejectedDraft_Returns403` verifies gate holds.

Also caught: Inference was treating a table's own primary key as a self-referential FK (e.g., `user_id` PK on `users` table inferred join to itself). Fixed in inference heuristics (FK filter now excludes PKs). Caught by join-discovery test.

## What We Tried

1. **Code review audit from first commit:** Reviewer traced the "accept" path and asked "where's the game check?" Good instinct, but we should have instrumented this *before* review.
2. **Re-reading the documented trap:** We knew about the pattern but didn't reference it in code. Added inline comment linking to `docs/lessons-learned.md#game-gate-trap`.
3. **State machine diagram:** Sketched pending → accept → approved → write. Spotted the missing precondition immediately.
4. **Regression test suite:** Created `auth-bypass-guard-tests.ts` with 6 tests (cross-game, state sequence, double-approve, etc.).

All fixes straightforward once root cause identified, but preventable if we'd instrumented the documented pattern.

## Root Cause Analysis

**Why RBAC bypasses shipped to review:**

1. **Documented pattern not enforced in code.** The "game gate trap" exists in `docs/lessons-learned.md` as a *warning*, not a *guard*. No linter, no middleware, no test template to enforce it. Result: developers (us) knew the pattern but it didn't catch the absence.

2. **Happy-path-only test mentality.** Tests verified "editor accepts draft, approves draft, writes YAML" — a valid user flow. We didn't test the *invalid* flows (cross-game, wrong state) because "that should never happen." It did, silently.

3. **State machine not modeled as code.** Approval gate lives as prose in the phase spec ("3-state triage: pending → accept → approved → write"). Prose doesn't catch missing preconditions. A Zod schema or enum FSM would have.

4. **Credential-free design suddenly has credentials.** The playground typically owns no secrets (reads public Cube, public datalake views). This is the first feature that takes Trino warehouse creds. We designed the gate but didn't emphasize the novelty in code review instructions.

## Lessons Learned

1. **Documented patterns need guards.** Paste the "game gate trap" guard as a required middleware or utility function, not as a comment. Lint for it.
2. **State machines belong in Zod/enums, not prose.** Define state transitions as a Zod discriminated union. TypeScript will enforce preconditions at compile time.
3. **New credential surfaces need security-focused code review.** This was the first feature to hold warehouse creds. Mandatory pre-review: threat model + STRIDE pass + security checklist.
4. **Test invalid paths, not just happy path.** Create a "guard tests" module per resource. Each guard route gets 2 tests: (1) authorized actor succeeds, (2) unauthorized actor gets 403.
5. **Inference heuristics need negative tests.** PK-as-FK was obvious once tested; should have had `TestInference_PkIsNotFk` from day 1.

## Next Steps

1. **Merge with fixes:** Current branch has both RBAC tests + fixes. Merge once this journal is filed.
2. **Security review (optional):** Consider delegating to `/ck:security` for Trino creds handling + proxy isolation + connector registry access patterns.
3. **v1.5 enrichment layer:** LLM enrichment + golden-query seeding currently flag-gated OFF. Safe to enable after security review.
4. **Multi-cube routing:** Current v1 assumes single-cube-per-connector. Phase next: detect multi-cube datalakes and route drafts separately.
5. **Live coverage/drift embed:** Triage canvas will eventually embed coverage and drift tabs side-by-side with YAML editor; deferred to post-stabilization.

**Owner:** Lead (security review sign-off). Feature is production-ready pending optional security audit.

---

**Status:** RESOLVED
**Summary:** Cube model onboarding agent (8 phases, 442 tests) shipped. Bootstrap stage complete: Trino introspect → profile → infer Cube skeleton → triage → stage draft → approve & write. Code review caught 2 RBAC bypasses (game grant, state precondition), both fixed + regression-tested before merge. First direct warehouse access in playground; credential + scope surface now live.

**Concerns:** Security review of Trino creds + proxy isolation recommended. Enrichment layer (LLM + golden queries) currently OFF; wire up after audit. Multi-cube support deferred to v1.5.
