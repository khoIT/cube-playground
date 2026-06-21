# Phase 3 · Metric-layer parity audit

**Priority:** P1
**Status:** pending
**Depends on:** Phase 0 (can run parallel to 1/2 — different surface)

## Overview
Audit the layer ABOVE the cubes: 73 business-metric YAMLs, glossary terms, and the chat knowledge seed — all of which reference cube members by logical name. Catch dangling refs (member exists in no cube) and cross-game parity gaps (measure cfm has that peers lack). Reuse the existing checkers; do not rebuild.

## Key insights
- This is the bug class that bit before ("measures referenced in metric YAMLs that exist in no cube"). The checkers already exist (`audit:metric-trust`, `coverage`, `glossary/integrity`) — Phase 3 is mostly running them per game and reconciling output, plus validating the chat seed members against live `/meta`.
- Distinguish **fixable gap** (source table exists, measure just never added) from **blocked gap** (source absent — gacha/tutorial/money_flow/funnel) which is N/A, not a fix.

## Requirements
- Per game G ∈ all 8: `GET /api/business-metrics/coverage?game=G` → collect broken refs + uncovered measures.
- `npm run audit:metric-trust` → per-game CERTIFIED/READY/GAP/N-A buckets; reconcile against the playbook snapshot (72.8% certified baseline) to spot regressions.
- `GET /api/glossary/integrity` → dangling primary/secondary catalog refs (e.g. churn_rate).
- Validate every `member` in `chat-service/seed/game-topic-knowledge-seed.json` resolves in `/meta` for that game (probe with `x-cube-workspace: local`).
- Build the cross-game measure-parity matrix: for each measure, which games have it; flag cfm-only measures whose source table EXISTS in other games (fixable) vs source-absent (N/A).

## Architecture / approach
- Output `reports/metric-layer-findings.md` with three tables: dangling refs, fixable parity gaps, blocked/N-A gaps.
- Tie each dangling ref back to the cube fix it needs (links into Phase 1/2 cube findings where the missing member is the root cause).

## Related code files
- Read/run: `server/src/scripts/audit-and-promote-metric-trust.ts`, `check-metric-drift.ts`, `services/metric-coverage-resolver.ts`, `routes/glossary.ts`
- Read: `server/src/presets/business-metrics/*.yml`, `chat-service/seed/game-topic-knowledge-seed.json`, `docs/metric-trust-audit-playbook.md`
- Create: `reports/metric-layer-findings.md`

## Implementation steps
1. Run coverage endpoint for all 8 games; collect broken refs + uncovered.
2. Run audit:metric-trust + glossary integrity; reconcile vs playbook baseline.
3. Probe chat-seed members against `/meta` per game.
4. Build parity matrix; split gaps fixable vs blocked.

## Todo
- [ ] coverage per game (8) · [ ] metric-trust + glossary integrity
- [ ] chat-seed member resolution check
- [ ] cross-game parity matrix (fixable vs blocked split)
- [ ] findings written

## Success criteria
- Complete list of dangling refs with the cube-member fix each needs.
- Parity matrix clearly separates fixable gaps from source-blocked N/A.
- Chat-seed members all resolve, or unresolved ones listed.

## Risks
- Coverage endpoint needs a running server + live `/meta`. If unavailable, fall back to static resolution against the dev YAML member list (lower fidelity, note it).

## Next
Findings → Phase 4 dedupe/triage (metric-layer findings often share a root cube cause with Phase 1/2).
