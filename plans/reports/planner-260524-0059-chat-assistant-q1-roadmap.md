# Planner Report — Chat Assistant Q1 Roadmap (Shape α)

**Date:** 2026-05-24
**Source brainstorm:** [brainstorm-260524-0059-chat-assistant-quarter-roadmap.md](./brainstorm-260524-0059-chat-assistant-quarter-roadmap.md)
**Plan dir:** [plans/260524-0059-chat-assistant-q1-roadmap/](../260524-0059-chat-assistant-q1-roadmap/plan.md)

## Summary
Expanded Shape α (Trust-first) brainstorm into Q1 implementation plan: 1 overview + 13 phase files.
Q1 scope = M1 Discovery + Infra Foundation (5 phases) → M2 Question Studio (4 phases) → M3 Memory + Saved Monitored Segments (4 phases). Deferred features (F12, F14–F22) excluded per brainstorm.

## Files created
- `plan.md` (overview, <80 lines, status table + deps graph + 5 open Qs)
- `phase-01-discovery-starter-library.md` — F1
- `phase-02-schema-cartographer.md` — F2
- `phase-03-concept-glossary.md` — F3
- `phase-04-suggested-followups.md` — F4
- `phase-05-monitoring-infra.md` — Track B
- `phase-06-editable-execution-plan.md` — F5 (CRITICAL catalog-consistency)
- `phase-07-sample-member-preview.md` — F7
- `phase-08-plain-english-filter-trace.md` — F6
- `phase-09-sanity-check-assistant.md` — F8
- `phase-10-persistent-chat-history.md` — F9
- `phase-11-user-glossary-memory.md` — F10
- `phase-12-saved-monitored-segments.md` — F13
- `phase-13-recents-rail.md` — F11

## Catalog-consistency enforcement (per brainstorm §Catalog-consistency rule)
- Phase-06 ships an e2e governance test that asserts every chat-emitted segment cites a catalog id.
- Phase-11 stores overrides referencing `catalog_ref`; resolver never returns a definition without source provenance.
- Phase-12 server-side gate refuses pinning of segments lacking catalog citation.

## Dependency graph
```
M1: 01,02,03,04 (Track A parallel) ╮
    05 (Track B parallel)          ├─► M2: 06 → 07,08 (parallel) → 09
                                   │
                                   ╰─► M3: 10 → 11; 12 (needs 05+06); 13 (needs 10+12)
```

## File ownership (no overlap)
- Frontend phases (01,02,04,13): `src/pages/Chat/`, `src/pages/Catalog/`.
- Backend phases (05,09,12): `server/src/`.
- Chat-service phases (06,07,10,11): `chat-service/src/` (+ small UI counterparts).
- Phase-03 spans server + UI but on distinct files.
- Phase-08 mostly UI; shares one util with phase-07 (DRY explicitly flagged).

## Key cross-phase callouts
1. **Divergence badge** appears in phase-06 + phase-11 — consolidate into single component (`divergence-flag-badge.tsx`) early.
2. **Predicate-to-explanation util** shared between phase-07 server + phase-08 client — extract once.
3. **Cron-runner extension** for monitored segments lives in phase-12, but tick reliability owned by phase-05.
4. **Memory scope** locked: per-user × per-game. Cross-game transfer opt-in deferred (open Q3).
5. **Notification scope** locked: in-app only Q1. Email/Slack deferred (open Q5).

## Risks tracked top-level
- Phase-06 cost (+$0.05/turn) needs benchmark gate before M2 ships.
- Phase-05 single-instance scheduler assumption inherited; multi-instance deferred.
- Phase-09 false-positive rate must be QA-validated before banner shows in prod.
- Phase-10 cross-game leakage in search — integration test gate.

## Open questions surfaced in plan.md (NOT resolved)
1. Scheduler location: chat-service vs main server. Recommendation: reuse existing `server/src/jobs/cron-runner.ts` (already production).
2. Persona detection: user-selected first-login vs behavior-inferred (phase-01 design step).
3. Per-game memory scoping transfer on opt-in (phase-11 — recommend NO default).
4. CDP API readiness for Q2 F17 — external dep, confirm before Q2 commit.
5. Notification dispatch surface in M3 — in-app toast only recommended (phase-05 locks this for Q1).

## Hard-constraint compliance check
- [x] No parallel-truth definitions — phase-06 + phase-11 + phase-12 enforce catalog citation.
- [x] Segment write scope unchanged — phase-12 pins existing segments; no direct write API.
- [x] Persona scope respected — phase-01 surfaces persona filter; no LCD UI.
- [x] Memory per-user × per-game only — phase-11 schema, no team-level fields.
- [x] In-app notifications only — phase-05 driver narrow scope; email/Slack deferred.
- [x] No Q2 features planned — F12, F14, F15, F16, F17, F18, F19, F20, F21, F22 all absent.

## Unresolved questions (planner-level)
1. **Embedding model choice (phase-10)** — TF-IDF Q1 vs install local model? Defaulted to TF-IDF for zero external dep; confirm.
2. **DB location for `notifications` + `monitoring_audit` (phase-05)** — same `segments.db` recommended; confirm.
3. **Token format for cartographer field chips (phase-02)** — `{{field:cube.member}}` proposed; confirm before agent prompt change.
4. **Storage shape for monitored segments (phase-12)** — extend `segments` table vs link table. Extend recommended.
5. **Auto-submit vs editable starter clicks (phase-01)** — submits immediately or prefills composer for tweak? Pick one before build.

**Status:** DONE
**Summary:** Created plan.md + 13 phase files at `/Users/lap16299/Documents/code/cube-playground/plans/260524-0059-chat-assistant-q1-roadmap/` and planner report at `/Users/lap16299/Documents/code/cube-playground/plans/reports/planner-260524-0059-chat-assistant-q1-roadmap.md`. All brainstorm hard constraints respected; deferred features excluded; 5 brainstorm open Qs surfaced in plan.md + 5 planner-level Qs flagged here.
