---
phase: 8
title: "Tests, Docs, and Rollout"
status: pending
priority: P2
effort: "1-2d"
dependencies: [3, 4, 5, 6, 7]
---

# Phase 8: Tests, Docs, and Rollout

## Overview
Harden and ship: end-to-end authz tests across the three dimensions, cross-repo game-enforcement test, docs updates, and a safe cutover that won't lock anyone out.

## Requirements
- Functional: full default-deny + grant matrix covered by tests; cross-repo (playground↔cube-dev) enforcement verified through the proxy.
- Non-functional: zero-lockout rollout; reversible; docs current.

## Architecture
- Test layers: unit (access-store, gates) from earlier phases + integration (login flows, admin API authz, `/api/games`, feature gate) + cross-repo (real-user JWT → Cube allow/deny). Test through the proxy (:3004), not just Cube directly (:3005) — per lessons-learned.
- Rollout sequence (flagged): (1) deploy DB + bootstrap admins seeded; (2) enable Microsoft IdP in KC; (3) pre-provision known users by email via admin API/UI; (4) flip workspace role-fallback flag OFF (Phase 4) once grants seeded; (5) enable cube-dev shared source (Phase 5) with deny-on-failure.
- Lessons-learned candidates: "authenticate ≠ authorize — brokered IdP needs app default-deny"; "scope game access server-side, never FE-only".

## Related Code Files
- Create: `server/src/**/__tests__/*` for access-store/gates/admin-API; cross-repo integration test harness.
- Modify (docs): `docs/system-architecture.md` (auth/authz model), `docs/deployment-guide.md` (KC Microsoft IdP, env vars, bootstrap admins, rollout), `docs/project-changelog.md`, `docs/lessons-learned.md`. Update parent plan `260527-1539-cube-workspace-switching` Phase 6 note (prod realm now handled here).
- Reference: prior shipped `x-cube-game` meta fix; `docs/lessons-learned.md` format.

## Implementation Steps
1. Fill test gaps: default-deny (unknown/pending/disabled), grant matrix per dimension, admin-only 403s, last-admin guard.
2. Cross-repo integration: PTG-only user allowed PTG / denied ballistar at Cube through the proxy.
3. Docs: architecture + deployment + changelog + lessons-learned; update parent plan note.
4. Rollout dry-run on staging; verify bootstrap admins never locked out; verify pending-user request-access UX.
5. Flip role-fallback off; enable cube-dev shared source (deny-on-failure); final smoke.

## Todo List
- [ ] unit + integration authz tests (all dimensions, default-deny)
- [ ] cross-repo game enforcement test through proxy
- [ ] docs: architecture, deployment, changelog, lessons-learned
- [ ] update parent plan Phase 6 note
- [ ] staging rollout dry-run (no lockout) + flip fallback off

## Success Criteria
- [ ] Test suite covers default-deny + each grant dimension + admin-only + cross-repo enforcement; all green.
- [ ] Staging cutover completes with no admin lockout and a working pending→approve flow.
- [ ] Docs reflect the new auth/authz model and rollout steps.

## Risk Assessment
- **Cutover lockout.** Mitigation: bootstrap admins seeded (Phase 2) verified before IdP flip; `AUTH_DISABLED` escape hatch documented for emergencies (local/break-glass only).
- **Hidden consumer of removed JWT claim** surfaces late. Mitigation: integration tests exercise FE game switcher + all gated routes.

## Security Considerations
- Verify fail-closed everywhere under test (deny on missing grant, on lookup failure, on non-admin).
- Confirm internal cube-dev access endpoint is not reachable from browsers.

## Unresolved Questions
1. Prod authz source of truth: playground SQLite vs a central auth-service DB (`duongnt5`/devops)? Decides Phase 5 source A/B target.
2. Grant key confirmed as **email** — acceptable given corporate email stability? (Reassignment edge case noted.)
3. Feature granularity for v1: which nav sections are gateable vs always-on? (Seed `feature-keys.ts` accordingly.)
4. Should `editor` vs `viewer` still come from anywhere in KC, or is role fully app-DB now? (Plan assumes fully app-DB.)
