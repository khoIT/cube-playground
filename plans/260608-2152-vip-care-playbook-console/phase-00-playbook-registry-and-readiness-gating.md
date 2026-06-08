# Phase 0 · Playbook Registry + Data-Readiness Gating + Threshold Calibration

**Priority:** highest — blocks all other phases.
**Status:** ✅ done (backend + tests). Live threshold calibration deferred to integration (needs reachable Cube). Review fixes applied: per-game `/meta` scoping (no cross-game union), `?game=` allow-list + path-traversal guard.
**Context:** [`../playbook-threshold-spec.md`](../playbook-threshold-spec.md), [`plan.md`](./plan.md).

## Overview
Define the 21 playbooks as **one declarative registry** + a per-(game×playbook) **availability resolver** + run **threshold calibration** against live data. No UI, no ledger yet — this is the contract every later phase reads.

## Key insight
Uniformity is the whole design: one config shape renders all 21, gates by data, and self-calibrates thresholds. Adding/editing a playbook = editing config, never code.

## Registry shape (per playbook)
```ts
interface Playbook {
  id: string;                 // "04"
  group: 'payment'|'ingame'|'churn'|'event';
  name: string;
  priority: 'cao'|'tb'|'thap';
  dataRequirements: string[]; // Cube members that MUST exist, e.g. ['mf_users.ltv_30d_vnd']
  condition: ThresholdRule;   // predicate template + calibration rule (percentile|ratio|abs|event)
  watchedMetric: { member: string; label: string; kpiTarget?: string };
  action: { text: string; channels: string[]; slaMinutes?: number };
}
```
`ThresholdRule` carries the rule kind (`percentile{p, of, gate}` | `ratio{value, vs}` | `abs{member, op, value}` | `event{member, window}` | `tierStep{member, bands}`) so it recomputes on refresh instead of freezing a number.

## Persistence: seeded canonical + DB overrides (two-tier)
The registry is **layered**, so Phase-6 authoring has somewhere to write without forking the canonical set:
- **Seed layer** — the 21 doc playbooks live in `playbook-registry.ts` (version-controlled). Not deletable; CS may only enable/disable + tune thresholds.
- **Override/addition layer** — table `care_playbooks { id, game_id, base_id (null=net-new), name, group, priority, condition_json, watched_metric_json, action_json, data_requirements_json, enabled, owner, created_at, updated_at }`. A row with `base_id` set = override of a seed for that game; `base_id=null` = a brand-new CS-authored playbook.
- **Merge on read:** `GET /api/care/playbooks?game=` returns `seed ⊕ overrides` (override wins per field), each with resolved availability + seeded/calibrated threshold. This is the single source every surface (monitor, builder, ledger) reads.

## Availability resolver
`resolve(playbook, game)` → `'available'|'partial'|'unavailable'`:
1. fetch live `/meta` for the game's workspace (cache per game).
2. every `dataRequirements` member present → candidate available.
3. members tagged per-member-only (raw `etl_*`) or needing event-flag/ops-input → `partial`.
4. any required member missing → `unavailable` (frontend greys row, runs **no** cohort query).
Per game: jus returns `unavailable` for all NHÓM 2; cfm returns `available` once Phase-4 mart members appear — **same registry, no edits**.

## Related files
- Create: `server/src/care/playbook-registry.ts` (the 21 seed configs), `server/src/care/threshold-rule.ts` (rule types + predicate-tree compiler), `server/src/care/availability.ts` (resolver), `server/src/care/playbook-merge.ts` (seed ⊕ overrides), `server/src/db/migrations/0XX-care-playbooks.sql` (override table), `server/src/routes/care-playbooks.ts` (`GET /api/care/playbooks?game=` → merged registry + resolved status + thresholds).
- Read for context: `server/src/types/predicate-tree.ts`, `server/src/services/translator.ts`, `server/src/routes/identity-map.ts` (meta-fetch pattern), `workspaces.config.json`.

## Implementation steps
1. Encode all 21 playbooks in `playbook-registry.ts` from the threshold spec (condition rule + watchedMetric + action + dataRequirements + per-group).
2. Implement `threshold-rule.ts`: compile a `ThresholdRule` + live calibration result → a `PredicateNode` (reuse existing tree → Cube filter path).
3. Implement `availability.ts` resolver against cached `/meta` per game.
4. **Calibration runner** (`server/src/care/calibrate.ts` + CLI): for each available rule, run its calibration query (per spec) against the game workspace, record live distribution + chosen cutoff + resulting cohort size back into `playbook-threshold-spec.md`; assert cohort size > 0 and within sane band.
5. `GET /api/care/playbooks?game=cfm_vn|jus_vn` returns registry + resolved status + seeded thresholds.
6. Unit tests: resolver (missing member → unavailable), rule→predicate compile, calibration assertion (empty cohort → flag, not enable).

## Todo
- [ ] 21 configs encoded
- [ ] ThresholdRule → predicate compiler + tests
- [ ] Availability resolver + per-game meta cache + tests
- [ ] Calibration runner; thresholds confirmed for cfm_vn + jus_vn; spec updated with real numbers
- [ ] `/api/care/playbooks` endpoint

## Success criteria
- `GET /api/care/playbooks?game=jus_vn` → NHÓM 2 all `unavailable`; spend/churn/anniversary `available` with non-empty calibrated cohorts.
- `GET ...?game=cfm_vn` → NHÓM 2 `unavailable` pre-mart, others `available`.
- No hardcoded threshold numbers in code — all via `ThresholdRule` + calibration.

## Risks
- Live `/meta` unreachable headless (seen this session) → calibration runner must run where the workspace is reachable (host dev / prod-mirror); document the run target. Until calibrated, playbooks stay disabled (fail-closed), never enabled on guesses.
