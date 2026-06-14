# Phase 05 — Tests & docs

## Overview
- Priority: P2
- Status: not started
- Depends on: phases 02–04

## Tasks
1. **Drift test.** Confirm/extend the FE↔server member360 registry drift test to cover jus_vn
   (panels/sections present on both sides).
2. **Coverage classification tests.** Unit-test `member360-coverage` status logic with fixtures:
   fully modeled+rows → `ready`; subset modeled → `partial`; modeled+empty → `modeled-empty`;
   unmodeled → `blocked`. Test prefix-workspace physicalization path too.
3. **Smoke.** jus_vn 360 page renders core panels locally; unsupported-game empty state renders.
4. **Docs.**
   - `docs/lessons-learned.md`: add entry — "Member 360 is gated across 3 layers (Trino → user_360
     view YAML → product PANELS/SECTIONS + server registry); local view YAML ≠ prod (prefixed/upstream).
     Signal to spot: 360 link missing for a game whose segments work fine."
   - `docs/codebase-summary.md` / `system-architecture.md`: document the coverage service + surfaces.
   - `docs/design-guidelines.md`: if the status-chip/matrix is a new reusable pattern, record it.
5. **Project tracking.** Update `docs/project-changelog.md` + roadmap per documentation-management rules.

## Success criteria
- `npm test` (FE + server) green, no skipped/fake assertions.
- Docs updated; lessons-learned entry added.

## Open questions (carry to execution)
1. Does prod (prefixed/kraken) already expose `jus_*` 360 views, or is upstream modeling required
   before prod jus_vn 360 can work? (phase-00 task 6 / phase-01 risk.)
2. Is `cube-dev-old` still the live local model source, or has it moved to a `cube-dev` checkout?
   (Only `cube-dev-old` present locally now — confirm before editing YAML.)
3. Reuse `BALLISTAR_PANELS` for jus (alias) vs fork `JUS_PANELS` — decide in phase-00 from the field diff.
4. Should `modeled-empty` block the 360 link (hide) or show with an empty-state? (UX call.)
