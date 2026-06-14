# Phase 5 · Contact Governance + KPI Auto-Eval Loop

**Priority:** medium — closes the loop, prevents over-contact.
**Status:** pending. **Gates:** blockedBy 1, 3.

## Overview
Two cross-cutting mechanisms over the ledger: (1) **contact-fatigue governance** so a VIP matching many playbooks isn't spammed, and (2) **KPI auto-eval** so each treated case re-checks its metric after the KPI window and feeds the monitor's attainment %.

## Contact governance
- **Fatigue cap** (resolved default): **max 1 proactive outreach / VIP / 24h** + per-channel cooldown (call 7d · Zalo ZNS 48h · in-game/push 24h), configurable per game. Before surfacing a "Take care" action, query the VIP's `care_cases` for `treated_at` across **all** playbooks in the window → over cap ⇒ queue row `Deferred` + ⚠. **Exception:** `cao`-priority cases over cap render as **"blocked — override?"** so a human decides (never silent suppression).
- **Priority arbitration:** when N open cases for one VIP, surface the highest registry `priority`; stack the rest. Optional **bundling**: suggest delivering lower-priority treatments in the same contact.
- Config table `care_governance { game_id, max_contacts_per_window, window_hours, per_channel_cooldown_json }`.

## KPI auto-eval
- A scheduled job: for each `treated` case past its `kpi_eval_at` (= treated_at + KPI window from registry), recompute the watched metric for that uid/cohort vs `kpi_target` → set `outcome` (`kpi_met|kpi_missed`) and `status='resolved'`.
- Feeds monitor "KPI attainment %" = resolved kpi_met / resolved.

## Related files
- Create: `server/src/db/migrations/0XX-care-governance.sql`, `server/src/care/fatigue.ts`, `server/src/care/kpi-eval-job.ts`.
- Modify: `action-queue.tsx` (consume fatigue verdict), case-engine/worker (schedule kpi eval), portfolio-strip attainment source.
- Read: registry (priority, kpiTarget, slaMinutes), `care_cases`.

## Implementation steps
1. Governance config table + `fatigue.ts` (cross-playbook window query → allow/defer).
2. Action-queue consumes fatigue verdict (replace Phase-3 placeholder).
3. Priority arbitration + bundling hint in by-vip aggregation.
4. `kpi-eval-job.ts` scheduled; resolves treated cases; SLA-breach detection (treated_at − opened_at > slaMinutes).
5. Tests: fatigue defers second outreach in window; kpi job resolves met/missed; SLA breach flagged.

## Todo
- [ ] governance config + fatigue evaluator
- [ ] action-queue fatigue integration
- [ ] priority arbitration + bundling
- [ ] KPI auto-eval job + SLA breach
- [ ] tests

## Success criteria
- VIP contacted 2h ago with cap 1/24h → second playbook outreach shows `Deferred`.
- A treated 02-tier case auto-resolves `kpi_met` when ARPU90d target met after the window.
- Monitor SLA-breach + attainment cells populate from real case outcomes.

## Carried from Phase-1 review
- **`condition_lapsed` has no un-flag path.** A VIP who exits a cohort (case flagged `condition_lapsed=1`, kept open) then re-enters stays flagged forever — `membershipDiff` sees them in the open set, so no new event clears it. Phase 5 must decide: clear the flag on re-entry, and/or auto-dismiss lapsed cases after the grace window. (engine: `care-case-engine.ts` `applyMembershipResult`.)

## Risks
- KPI windows are long (30–90d) → eval job must be idempotent and resumable; don't double-resolve.
- Fatigue cap policy unconfirmed (open Q #2) → ship configurable, seed conservative default.
