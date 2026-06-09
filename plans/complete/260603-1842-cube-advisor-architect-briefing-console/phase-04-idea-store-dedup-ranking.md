---
phase: 4
title: "Idea store + dedup + ranking"
status: complete
priority: P1
effort: "1d"
dependencies: [2, 3]
---

# Phase 4: Idea store + dedup + ranking

## Overview
Turn a raw `ideas.json` into a persistent, deduplicated, ranked backlog. Validates the idea schema, reconciles each candidate against prior ideas AND already-planned work, ranks open ideas per category, and exposes read/status APIs the dashboard consumes.

## Requirements
- Functional: ingest validates against the idea schema (reject/quarantine malformed); upserts ideas by fingerprint; applies `dedupVerdict` (`new` | `duplicate-of:<id>` | `already-planned`); ranks open ideas per category by score; status APIs read/mutate.
- Non-functional: dedup + rank are **pure, unit-tested functions** (no I/O); ingest is idempotent (re-ingesting same run changes nothing).

## Architecture
- `idea-schema.ts` (zod): the contract from the design doc — `id, category, title, oneLiner, problem, evidence[]{type,ref,quote}, proposal, impact(1-5), effort(1-5), confidence, risks[], suggestedVisual{kind,spec}, sources[], fingerprint, dedupVerdict`.
- Dedup strategy = **LLM-side primary, backend-side guard**: the prompt (Phase 5) already classifies each candidate against the injected backlog + plan index, emitting `dedupVerdict`. Backend trusts the verdict but guards with a fingerprint match (normalized title+problem tokens) to catch obvious collisions the model missed → merge (bump `run_last`, keep earliest `run_first`).
- Ranking: `score = impact - effort` (both 1-5, pure fn, no configurable weights for v1 — see hardening); `confidence` (1-5) is a display/tiebreak signal, NOT a score addend (avoids unbounded-scale swings); `already-planned`, `dismissed`, and snoozed-until-future excluded; Briefing "top 3" per category = top-scored `status=new` (accepted ideas move to the "In motion" lane — see hardening).
- `GET /api/ideas?category&status` returns ranked; `PATCH /api/ideas/:id` sets status + writes `idea_status_log`.

## Related Code Files
- Create: `backend/src/ideas/idea-schema.ts`, `backend/src/ideas/dedup.ts`, `backend/src/ideas/rank.ts`, `backend/src/ideas/ingest.ts`, `backend/src/ideas/repo.ts`
- Create: `backend/src/routes/ideas.ts` (`GET /api/ideas`, `PATCH /api/ideas/:id`)
- Modify: `backend/src/runner/...` ingest seam → real `ingest()`
- Create tests: `backend/test/idea-schema.test.ts`, `dedup.test.ts`, `rank.test.ts`, `ingest.test.ts`, `ideas-route.test.ts`
- Create fixtures: `backend/test/fixtures/ideas.valid.json`, `ideas.malformed.json`, `prior-backlog.json`

## TDD — Tests First
1. `idea-schema.test.ts`: valid fixture passes; malformed (missing evidence/out-of-range impact) rejected with clear errors.
2. `dedup.test.ts`: candidate identical-by-fingerprint to a prior idea → merged not duplicated; `already-planned` verdict → excluded from ranking; novel → `new`.
3. `rank.test.ts`: deterministic ordering for known impact/effort/confidence sets; ties broken stably; excluded statuses absent.
4. `ingest.test.ts`: ingesting `ideas.valid.json` writes N ideas; re-ingest is a no-op; malformed run quarantined (run marked `failed`, no partial writes).
5. `ideas-route.test.ts`: `GET` returns ranked top-N per category; `PATCH` transitions status + logs it; invalid transition rejected.
6. Implement until green.

## Implementation Steps
1. Define zod `idea-schema.ts` (single source of truth, shared with frontend types via export).
2. Implement pure `dedup.ts` + `rank.ts`.
3. Implement `repo.ts` (better-sqlite3 CRUD) + `ingest.ts` (validate → dedup → upsert → close run) in a transaction.
4. Replace Phase 3 ingest stub with real `ingest()`.
5. Implement `ideas.ts` routes.
6. Green tests.

## Success Criteria
- [ ] All idea unit/route tests green; dedup + rank proven pure & deterministic
- [ ] Re-ingesting a run is idempotent; malformed JSON never partially writes
- [ ] `GET /api/ideas` returns top-3 ranked open per category; status changes persist + log

## Risk Assessment
- Over-trusting LLM `dedupVerdict` → fingerprint guard catches obvious dupes; manual `dismiss` is always available as backstop.
- Score weighting is subjective → see hardening below (fixed `impact - effort` for v1, no premature weights).

## Red Team Hardening (applied)
- **Canonical schema, split LLM-emitted vs backend-assigned** (#5): the zod schema is the single source of truth and MUST include the run-tracking + lifecycle fields the brainstorm spec'd (`firstSeenRun`, `lastSeenRun`, `status`). Partition fields: **LLM emits** category/title/oneLiner/problem/evidence/proposal/impact/effort/confidence/risks/suggestedVisual/sources/dedupVerdict; **backend assigns** id/status/firstSeenRun/lastSeenRun/fingerprint. The prompt-contract (Phase 5) must NOT demand the model emit backend-owned fields. `repo.ts` owns the camelCase↔snake_case DTO mapping.
- **Pin `confidence` scale** (#12): `confidence` is `1-5` (same scale as impact/effort), validated in schema + asserted in the prompt contract. Prevents 0-1-vs-1-5 cross-run score swings.
- **Fixed ranking for v1** (#SC3): `score = impact - effort` (both 1-5), pure + tested. No configurable weights until real runs show mis-ordering (YAGNI). Ranking excludes `dismissed`, `already-planned`, and snoozed-until-future.
- **Terminal status never downgraded on merge** (#8): fingerprint-merge bumps `last_seen_run` but MUST preserve a user-set terminal status — a `dismissed` idea that re-matches stays `dismissed` (this is what makes "re-runs don't re-pitch dismissed" true). Explicit test: dismissed-stays-dismissed across re-ingest.
- **Validate LLM verdicts defensively** (#15): on ingest, strip ```json code fences before parsing; validate every `duplicate-of:<id>` points at an EXISTING idea id and every `already-planned` maps to a real plan in the index — unverifiable → downgrade to `new` + flag (never silently drop a real idea on a hallucinated id). Sanitize `evidence[].ref` (reject `javascript:`/`data:` schemes) at ingest so the frontend can't render hostile links.
- **Don't block the event loop** (#7): run dedup/rank (pure fns) OUTSIDE the better-sqlite3 transaction; the transaction does only the upserts. `fingerprint` is indexed (Phase 2). Run-level idempotency (re-ingest same run = no-op) is tracked separately from cross-run fingerprint merge so the two don't contradict.
- **Idea status state-machine** (#SC9): define explicit transitions — `new → accepted` (on handoff) `→ shipped`; `new/accepted → dismissed`; `new → snoozed(until) → new`. Briefing shows top-3 of `status=new` (accepted ideas move to a "In motion" lane, not Briefing) so accepted items don't crowd Briefing forever. Snooze has a wake date.
