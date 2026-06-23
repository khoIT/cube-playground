# Phase 04 — Per-game coverage verification + eval sweep (Layer B)

**Priority:** medium (runs after Layer A merges). **Status:** not started.
**Scope:** verification + data, not resolver code. **Games:** all 8.

## Why
Layer A (Phases 01/02) is code-once and game-generic. The real-data probe
(2026-06-23) already confirmed the members it depends on are present and
identically named in all 8 games. This phase is the **proof**: verify the one
residual data assumption (glossary revenue mapping) and run the eval per game to
turn "should generalize" into a measured answered-rate per game.

## The one residual per-game assumption
`smart-defaults.resolveRevenueDefault(glossary)` reads each game's glossary. The
underlying `revenue_vnd` measure exists in all 8, but if a game's glossary maps the
`revenue` concept to a cfm-only ref (`revenue_vnd_real`) or omits a revenue term,
the money-cue default silently degrades to ask-first on that game. Must verify the
mapping resolves to a measure present in that game.

## Steps
1. **Glossary revenue mapping per game** — for each of the 8 games, dump the glossary
   `revenue` concept and assert its `measureRef` resolves to a measure in that game's
   /meta (expected: `revenue_vnd`). Flag any game pointing at `revenue_vnd_real` or
   missing a revenue term; fix the glossary mapping (not the resolver).
2. **Build per-game eval snapshots** — same synthesized-glossary case shape as
   `cfm_vn-glossary-aq-snapshot.json`, one per game (jus_vn first, then the other 6).
   Reuse the structural cube-parity harness to pre-flight member parity before
   spending turns.
3. **Run the eval subset per game** on host :3005, subscription lane, workspace=local:
   `GAME=<game> GROUP=synthesized-glossary RESUME=1 RESUME_KEEP=ok PACE_MS=3000 …`
   Loop all 8; respect the subscription session cap (paced/fail-fast/resumable).
4. **Record answered-rate delta per game** in the report. A game below target after
   Layer A indicates either a glossary gap (fix here) or a genuine data gap (escalate,
   e.g. cros/tf WAU → Phase 03).

## Success criteria
- All 8 games' glossary `revenue` concept resolves to a measure present in that game.
- Per-game answered-rate measured and recorded; resolver-class gaps closed on every
  game, remaining misses attributable to a named data gap.

## Risks
- Subscription session cap: batching 8 games' turns can exhaust the lane — pace,
  fail-fast on auth-cap, resume. Don't burn the gateway key.
- Per-game glossary may be sparser than cfm's (cfm is the richest); a missing term is
  a glossary fix, not evidence the resolver fix failed.

## Todo
- [ ] verify glossary revenue→measure mapping for all 8 games
- [ ] build per-game eval snapshots (jus_vn first)
- [ ] run eval subset per game, paced/resumable
- [ ] record per-game answered-rate delta in report
- [ ] triage residual misses: glossary fix here vs data gap → Phase 03
