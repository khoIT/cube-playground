# Brainstorm — CS Dashboard as a Customer-Support Demo Artifact

> Date: 2026-06-09 · Scope approved via clarifying Qs · No code written (brainstorm only)

## Problem

CS console (`/dashboards/cs`) reads convincingly but the **core CS loop is broken at the action step**: a case surfaces → agent opens Member-360 → "treats" → but treatment is a **client-side mock** (`cs-member360-mock.ts`, not persisted). Want low-effort / high-visibility features that make it a true demo artifact for customer support.

## Key insight

The demo story is a loop: *case surfaces → claim → open 360 → take action → case leaves queue → see if it worked.* Backend for almost the whole loop already exists; the FE just doesn't use it.

## What's built vs gap (verified)

| Capability | Status |
|---|---|
| `PATCH /api/care/cases/:id` (status/assignee/channel_used/action_taken/notes/outcome) | live, Zod-validated (`routes/care-cases.ts:265`) |
| `patchCareCase()` FE helper | exists (`use-care-cases.ts:336`) |
| lifecycle stamps (treated_at / closed_at) | in `patchCase` (`care-case-store.ts:163`) |
| `runKpiEval()` met/missed logic | exists but UNWIRED (`care/kpi-eval.ts:79`) |
| reset / clear-all cases | absent (only single-id `deleteCases`) |
| Member-360 timeline + recommended-action rail | fully MOCK |

## Approved scope

Tier A + Tier B, real + reseedable. KPI outcome = **human-closes** (no Cube auto-eval). Reset = **guarded wipe + re-sweep**.

## Design

### A1 — Persist Mark-treated + log action (biggest slice)
- Rail target = VIP's real highest-priority open case (`useVipCaseHistory` + playbook meta), not `SAMPLE_RECOMMENDED_ACTION`. Talk-track/offer/SLA = playbook-derived guidance (kept generic, not per-VIP fiction).
- Timeline renders real `cases`; sample only when VIP has 0 cases (graceful fallback).
- "Mark treated" → inline form (channel, action, note) → `patch{status:'treated',channel_used,action_taken,notes}` → refetch. Case → green, leaves open queue, shows in real history.
- Touchpoints: `cs-member360-view.tsx`, `cs-recommended-action-rail.tsx`, `cs-care-history-timeline.tsx`. Server: none.

### A2 — Claim / Assign to me
- Queue + 360 "Claim" → `patch{assignee:user.username}`; "owned by X" chip (own = brand tint, other = muted). Server: none.

### A3 — Dismiss with reason
- "False positive / Not now" + reason select → `patch{status:'dismissed',notes:'reason:…'}`; leaves queue, shows Dismissed+reason in history. Server: none.

### B4 — "Did it work?" outcome badge (human-closed)
- Treated case gets "Close · KPI met / KPI missed" control → `patch{status:'resolved',outcome}`. Resolved rows show `kpi_met ✓ / missed` badge.
- Verify whether `PortfolioStrip` aggregates outcome/attainment; if yes, wire it (it's the ROI slide). Server: none.

### B5 — Export queue → CSV
- Button on By-VIP / By-Playbook; client-side CSV (uid, name, LTV, tier, top playbook, open-case count, last contact, status). Fetch full set un-paginated for export. Pure FE.

### B6 — Today's activity strip
- "N treated · M dismissed (24h)" + last few events on queue. Small server aggregate read (cheap SQLite) to avoid pulling all cases client-side.

### Reseed
- `clearCases(game,workspace)` in store + guarded `POST /api/care/cases/reset?game` (editor/admin, confirm) → wipe game's cases → optional re-sweep. Small server addition.

## Effort / risk

- Tier A: mostly FE wiring (PATCH + helper exist). A1 largest (mock→real). A2/A3 small.
- Tier B: B5 trivial FE; B4 small (human-set); B6 tiny aggregate.
- Reseed: small server.
- **No schema changes** (columns exist). Low risk. New behavior: queue is mutated during demo (intended); reset covers re-runs. Strong existing test coverage on care engine/store → **TDD plan recommended** to lock current behavior before touching it.

## Suggested phasing

1. A1 persist treatment (the payoff) → 2. A2 claim + A3 dismiss → 3. B4 outcome close + badge → 4. B5 export + B6 activity → 5. reset endpoint + button.

## Open questions

1. Does `PortfolioStrip` already aggregate `outcome` for attainment %? (verify in plan; affects B4 wiring) 
2. Activity strip (B6): confirm a new `/api/care/activity` endpoint is acceptable vs deriving client-side.
3. Reset: re-sweep automatically after wipe, or leave operator to click Run sweep? (defaulting to optional auto re-sweep).
