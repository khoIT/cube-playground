---
phase: 8
title: "Plan-handoff + polish"
status: pending
priority: P2
effort: "0.5d"
dependencies: [6, 7]
---

# Phase 8: Plan-handoff + polish

## Overview
Close the act-on loop: "Accept → create plan" turns an idea into a `/ck:plan`-ready brief dropped into `cube-playground/plans/`, so the architect can go straight from briefing to implementation. Plus end-to-end docs and final polish.

## Requirements
- Functional: `POST /api/ideas/:id/plan` writes a brief markdown into `cube-playground/plans/reports/` (new file only, never overwrites) named per the cube-playground naming convention, containing the idea's problem/evidence/proposal/risks formatted as a brainstorm-style handoff. UI "Accept" offers "Create plan brief" → calls endpoint → links to the written file.
- Non-functional: write is path-guarded (only into the configured cube-playground plans dir); idempotent per idea (re-accept updates the same brief, doesn't duplicate); sets idea status → `accepted`.

## Architecture
- `plan-handoff.ts`: renders idea → brief markdown (reuse the brainstorm-report shape: problem, evidence, proposal, risks, suggested phases stub) → writes to `${CUBE_PLAYGROUND_DIR}/plans/reports/advisor-<date>-<slug>-brief.md`.
- Path guard: resolve + assert the target is inside the configured plans dir before writing (no traversal).
- Docs: `../cube-advisor/README.md` (run instructions, MCP prerequisite, the Phase 1 recipe, cost/latency expectations, fallback notes).

## Related Code Files
- Create: `backend/src/handoff/plan-handoff.ts`, `backend/src/routes/handoff.ts`
- Modify: `frontend/src/components/IdeaCard.tsx` (Accept → Create plan brief action + result link)
- Modify: `../cube-advisor/README.md`
- Create tests: `backend/test/plan-handoff.test.ts`, `handoff-route.test.ts`

## TDD — Tests First
1. `plan-handoff.test.ts`: idea fixture → brief markdown contains problem/evidence/proposal/risks + a slugged filename; writing twice for same idea targets the same path (idempotent); a path-traversal target is rejected.
2. `handoff-route.test.ts`: `POST /api/ideas/:id/plan` writes the file to a temp plans dir, returns its path, sets idea status `accepted`; rejects if idea id unknown.
3. Implement until green.

## Implementation Steps
1. Implement `plan-handoff.ts` (render + path-guarded write, idempotent by idea slug).
2. Implement `handoff.ts` route; transition status to `accepted` + log.
3. Wire `IdeaCard` Accept → Create plan brief → show link to written file.
4. Write `README.md` (prereqs, run, recipe, cost, fallback, troubleshooting).
5. Green tests; full manual end-to-end: Generate → review → Accept → brief appears in `cube-playground/plans/reports/`.

## Success Criteria
- [ ] `plan-handoff.test.ts` + `handoff-route.test.ts` green; traversal blocked; idempotent
- [ ] Accept writes a usable, `/ck:plan`-ready brief into `cube-playground/plans/reports/` and links it in the UI
- [ ] README lets a fresh user run the advisor end-to-end (incl. MCP prerequisite + fallback)
- [ ] Full loop demoed: button → researched briefing → accept → brief on disk

## Risk Assessment
- Writing into another repo → strict path guard + new-file-only (never overwrite existing plans); the advisor is read-only toward cube-playground source, write-only toward `plans/reports/`.
- Brief quality depends on idea quality → acceptable; the brief is a starting point for `/ck:plan`, not a final plan.

## Red Team Hardening (applied)
- **Filename keyed on idea id, not date+slug** (#14): brief filename = `advisor-<ideaId>-<sanitized-slug>-brief.md`. Keying on idea id makes re-accept idempotent (updates the SAME file) and resolves the "never overwrites" vs "re-accept updates" contradiction — the answer is: it updates the one brief for that idea, and never touches any OTHER idea's brief. Store the written path on the idea row.
- **Sanitize the slug + realpath guard** (#14/S5): the slug derives from an LLM-produced (injectable) title — strip to `[a-z0-9-]`, cap length, reject path separators/`..`. Before writing: resolve the target with `realpath`/symlink collapse and ASSERT it is inside `${CUBE_PLAYGROUND_DIR}/plans/reports/` (sentinel-file check that the dir is the real cube-playground). This blocks a crafted title like `../../.git/hooks/post-checkout` from planting an executable hook (`plans/reports/` is NOT git-ignored — verified).
- **One write target** (#A7): all docs now agree the brief goes to `cube-playground/plans/reports/` (plan.md + brainstorm reconciled). No `plans/` vs `plans/reports/` ambiguity.
- **Token-gated, loopback** (#1): the handoff route requires the shared secret (Phase 2) — a cross-repo file write must not be triggerable unauthenticated.
