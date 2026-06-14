# VIP Care Playbook Console

**Goal:** turn the 21-playbook VIP Care Program (`VIP_Data_Requirement_Final.docx`) into a live CS console — one playbook monitor + a stateful care-case ledger + per-VIP treatment history — built for **cfm_vn and jus_vn first**, with **data-calibrated thresholds** so real users qualify, and per-(game×playbook) **availability gating** that greys out playbooks whose data isn't modeled yet.

**Source flow:** `plans/260608-2128-vip-care-cs-console-flow/VIP Care CS Console Flow.html` (approved 3-surface flow).
**Threshold spec:** [`playbook-threshold-spec.md`](./playbook-threshold-spec.md) — all 21 conditions, calibration queries, per-game availability.
**Design analysis:** `plans/reports/from-vip-data-requirement-to-actionable-care-segment-260608-1918-design-report.md`.

## Core idea (KISS/DRY)
Playbooks are **data, not 21 bespoke dashboards**: one registry of uniform configs `{condition predicate, watched metric, KPI, action, channel, priority, dataRequirements}`, rendered by one grid. The case ledger is the single source of truth; three surfaces are lenses over it. Everything reuses the existing Segments predicate engine, refresh worker, and Member-360.

## Reachability (from data analysis)
- **jus_vn:** 6 fully + 3 partial/manual = 9/21. NHÓM 2 (in-game) entirely unavailable.
- **cfm_vn:** 12 fully + 5 partial = 17/21 (6 of the 12 need the gameplay mart, Phase 4).
- **Blocked on both** (no data source any game): 05 payment-fail, 13 sentiment, 16 ticket, 21 birthday.

## Phases

| # | Phase | Status | Gates |
|---|---|---|---|
| 0 | [Playbook registry + data-readiness gating + threshold calibration](phase-00-playbook-registry-and-readiness-gating.md) | ✅ done (backend; live calibration deferred to integration) | **BLOCKS all** — registry + gating contract first |
| 1 | [Care-case ledger + trigger/watched-metric engine (backend)](phase-01-care-case-ledger-and-trigger-engine.md) | ✅ done (ledger+engine+sweep+routes; live cron/trigger-eval deferred) | blockedBy 0 |
| 2 | [CS Monitor dashboard (Dashboards/CS)](phase-02-cs-monitor-dashboard.md) | ✅ done | blockedBy 0,1 |
| 3 | [Case Ledger / VIP Action Queue + Member-360 Care tab](phase-03-action-queue-and-member360-care.md) | ✅ done | blockedBy 1,2 |
| 4 | [cfm_vn gameplay-daily mart (unlocks NHÓM 2)](phase-04-cfm-gameplay-daily-mart.md) | pending (data-team dep) | blockedBy 0; data-team dep; parallel to 2/3 |
| 5 | [Contact governance + KPI auto-eval loop](phase-05-contact-governance-and-kpi-loop.md) | ✅ backend done (FE wiring + cron deferred) | blockedBy 1,3 |
| 6 | [Playbook Builder (authoring & overrides)](phase-06-playbook-builder.md) | ✅ done (Builder UI + supplemental-predicate persistence) | blockedBy 0,2; reuses Segments predicate builder |

## Sequencing
- **MVP (jus_vn + cfm_vn spend/churn):** 0 → 1 → 2 → 3 → 5. Ships 9 jus / 11 cfm playbooks on data available **today**.
- **Phase 4** (gameplay mart) runs in parallel as a data-team track; when it lands, cfm's 6 NHÓM-2 playbooks flip `unavailable → available` with **zero frontend change** (registry gating auto-detects the new members).

## Key constraints
- **Availability gating is per (game × playbook):** registry declares `dataRequirements` (Cube member names); at eval time check against live `/meta` for that game's workspace → missing member ⇒ status `unavailable` (greyed, no cohort query). jus shows NHÓM 2 unavailable while cfm shows available — same registry.
- **Thresholds are calibrated, not hardcoded:** percentile-of-live-cohort or personal-baseline ratios (see spec). Phase 0 runs calibration queries to seed concrete values; live-data probe was blocked this session, so spec carries starter estimates to confirm.
- **Reuse, don't fork:** predicate tree (`predicate-tree.ts`), refresh worker, Member-360, card-cache. New code = registry, ledger table, trigger eval, 2 surfaces.
- **Raw cfm `etl_*` cubes** (1.35B / 213M rows) must be queried per-member+bounded-date or via the Phase-4 mart — never full-cohort scans on refresh cadence (see preagg rollout plan).

## Resolved decisions
1. **VIP tier basis = `ltv_vnd` cumulative bands** (doc's ₫5/20/50/100M) as canonical; in-game `max_vip_level` shown in Member-360 as context only. Why: LTV is comparable across games; in-game vip_level scales differ per game and can't drive a multi-game console. Band populations calibrated in Phase 0.
2. **Contact-fatigue = max 1 proactive outreach / VIP / 24h + per-channel cooldown** (call 7d · Zalo ZNS 48h · in-game/push 24h), configurable per game. `cao`-priority cases that hit the cap surface as **"blocked — override?"** (human decision, never silent suppression). (Phase 5)
3. **Case assignment = shared pull pool** (assignee stamped on first action) + optional **AM affinity** (route a VIP to its known account manager first when set — honors the doc's "AM" language). MVP = pull pool. (Phase 3)
4. **`exited`-before-treatment = keep open, flag `condition_lapsed`** (CS still sees they slipped); auto-dismiss only after a configurable grace window. (Phase 1)
5. **Routes:** monitor `/dashboards/cs` · ledger/queue `/dashboards/cs/queue` · builder `/dashboards/cs/playbooks/new` + `/:id/edit` · Member-360 Care tab stays on existing `/segments/:id/members/:uid`. Stateful surfaces live under the `/dashboards/cs` namespace, reached from the monitor.
6. **Playbook authoring (two-tier) — resolves "where do I create/edit a playbook":** the 21 doc playbooks ship as **seeded canonical** configs (version-controlled, not deletable — only enable/disable + threshold tune); CS managers **create / clone / edit** via a **Playbook Builder** (new Phase 6), persisted as DB overrides/additions layered over the seeds. Entry points: **"+ New playbook"** in the monitor header, **"Edit / Clone"** per row. Builder reuses the **Segments predicate builder** for the condition.

## Implementation status (as of 2026-06-09)
**Shipped on `feat/vip-care-playbook-console` (2 commits): backend `5d41459`, frontend + predicate persistence `ee4ebde`. Phases 0,1,2,3,5,6 done & verified (server care suite 54 green, frontend care suite 55 green, tsc clean on all touched files). Phase 4 (gameplay mart) still a data-team dep.**

Phase 6 close-out:
- **Builder UI shipped** — 4-section form at `/dashboards/cs/playbooks/new` + `/:id/edit`; viewer read-only, editor/admin write; routes registered before the `/dashboards/:slug` catch-all.
- **Mutation id-routing fix** — resolved playbooks expose a display `id` that equals the seed base-id for overrides, while PATCH/DELETE key on the override row id. New shared `playbook-mutation-target.ts` routes seed→POST(base_id) and override/custom→PATCH(overrideId); fixes custom-edit 404 and override mis-targeting. Regression test `playbook-mutation-target.test.ts`.
- **Supplemental predicate persisted** (decision #6 fully realized) — optional AND/OR filter on the override (migration `039-care-playbook-supplemental-predicate.sql`), ANDed onto the compiled cohort predicate in `finalize`, round-tripped to the Builder, members fold into the data-readiness gate; a half-built tree blocks save (no silent drop). Test added to `care-playbooks-authoring.test.ts`.

Phase 5 (governance): `care_governance` table (migration 038) + `care-governance-store.ts` (defaults: 1/VIP/24h + call 7d·Zalo 48h·in-game/push 24h) + `fatigue.ts` (window cap + per-channel cooldown + `cao`→blocked_override) + `kpi-eval.ts` (numeric-threshold-only auto-resolve, SLA breach, idempotent job) + routes `GET/PUT /api/care/governance`, `GET /api/care/fatigue`. FE action-queue consumption + cron scheduling deferred (post-Phase-3 / live).
Phase 6 (authoring backend): override CRUD on `care_playbooks` (`createOverride`/`updateOverride`/`deleteOverride`, seed-overridden-not-deleted) + routes `POST/PATCH/DELETE /api/care/playbooks` (zod-validated ThresholdRule, editor/admin gated). Builder UI pending (blocked on Phase 3 to avoid monitor-file conflicts).
Write-role gate: `/api/care` added to `PROTECTED_PREFIXES` — all care mutations are editor/admin (viewers read-only).

**Phase 0 + Phase 1 backend shipped & verified** (server: tsc clean):
- `server/src/care/`: `threshold-rule.ts` (rule→predicate compiler), `playbook-registry.ts` (21 seeds), `availability.ts` (per-game resolver, scoped to one game's prefix — fixes prod union bug), `playbook-merge.ts` (seed⊕override), `care-playbooks-store.ts`, `game-scope.ts` (allow-list + path-traversal guard), `calibrate.ts` (CLI), `care-case-store.ts` (idempotent ledger), `care-case-engine.ts` (membership diff + trigger + by-vip), `care-case-sweep.ts` (injectable driver).
- Migrations `036-care-playbooks.sql`, `037-care-cases.sql` (additive, forward-only).
- Routes: `GET /api/care/playbooks?game=`, `GET /api/care/cases`, `/by-vip`, `/vip/:uid`, `PATCH /api/care/cases/:id`.
- Tests: `care-playbook-registry`, `care-playbooks-route`, `care-case-ledger`, `care-case-sweep`, `care-cases-route` (36 tests).

**Deferred to live integration** (need a reachable Cube workspace — blocked headless this session):
- Live threshold calibration (run `tsx src/care/calibrate.ts <game>` on host dev / prod-mirror; reconcile registry logical member names against real `/meta`).
- Automatic sweep scheduling (cron wiring) + live cohort fetch + per-member trigger-eval for ratio playbooks (03/04/15). `runCaseSweep` + `makeCubeCohortFetcher` are implemented and unit-tested via injection; only the cron tick / HTTP trigger remains.
- Percentile-rule cutoff computation in the calibrate CLI (no seed uses percentile today).

## Open questions
- VIP tier *band values* still need population confirmation against live data (Phase 0 calibration) — the *basis* (ltv_vnd) is decided.
- Registry logical member names (e.g. `mf_users.ltv_total_vnd`, `user_recharge_daily.revenue_vnd`) are best-effort and must be reconciled against live `/meta` during integration; mismatches fail closed (playbook shows unavailable), never a wrong cohort.
