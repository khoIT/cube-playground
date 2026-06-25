---
phase: 4
title: "Auto git-derivation (optional)"
status: pending
priority: P3
effort: "0.5d"
dependencies: [1]
---

# Phase 4: Auto git-derivation (optional)

## Overview

Reduce the per-reconcile manual effort by auto-deriving the mechanical fields (`lastTouched`, `health: stale`) from git, so each `/atlas reconcile` run gets faster and `health` drift is caught without hand-checking. Optional polish — only build if P1-P3 prove the atlas earns its keep (avoid YAGNI).

## Requirements

- Functional:
  - For each feature, compute `lastTouched` = most recent git commit date touching any path in `links.code`.
  - Propose `health: stale` when `status: shipped` and `lastTouched` older than a threshold (default 30d; configurable).
  - Surface a per-run summary: "N features untouched > threshold" so triage of rot is one glance.
- Non-functional:
  - Still a *proposal* — applied via the same approve/edit/drop flow; never silent.
  - Pure/read-only git reads; no network.

## Architecture

Extend `scripts/atlas-reconcile.mjs` with a derivation pass:
```
for each feature.links.code[]:
    git log -1 --format=%cs -- <path>   → max date = lastTouched
if status==shipped and (today - lastTouched) > stalenessDays:
    propose flag-health: stale
```
Threshold read from a small config (top of `atlas.yaml` e.g. `config: { stalenessDays: 30 }`) or a constant in the helper.

## Related Code Files

- Modify: `scripts/atlas-reconcile.mjs` (add git-derivation pass)
- Modify: `.claude/skills/atlas/SKILL.md` (surface the staleness summary)
- Modify: `scripts/__tests__/atlas-reconcile.test.mjs` (derivation tests on a fixture)
- Modify (maybe): `src/feature-atlas/atlas.yaml` (`config.stalenessDays`)

## Implementation Steps

1. Add `lastTouched` derivation from `links.code` paths via `git log -1 --format=%cs -- <path>`.
2. Add staleness proposal rule + configurable threshold.
3. Emit a staleness summary line in the proposal.
4. Test on a fixture with a stale shipped feature.

## Success Criteria

- [ ] Reconcile auto-fills `lastTouched` for features with `links.code`.
- [ ] Shipped + stale features get a `health: stale` proposal; threshold configurable.
- [ ] Staleness summary shown each run; all changes still go through approve/edit/drop.
- [ ] Derivation tests pass.

## Risk Assessment

- **Path → feature mapping imperfect** (a code path maps to multiple features, or feature has no `links.code`). Mitigation: derive only where `links.code` present; leave others manual; document.
- **Over-flagging stale** — legitimately-stable shipped features flagged repeatedly. Mitigation: allow a per-feature `pinHealth: true` opt-out, or just let user drop the proposal each run.
- **YAGNI** — if reconcile is already fast enough manually, skip this phase entirely.
