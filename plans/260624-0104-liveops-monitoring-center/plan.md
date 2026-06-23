# LiveOps Monitoring Center

Turn the thin `/liveops` (KPI strip + cohort + anomaly inbox) into a true liveops monitoring
center: a Command Center landing, a Diagnostics sub-hub (the 3 mocked surfaces), Monetization,
Retention, and an Alerts & Digests hub — reusing the large existing surface, building net-new only
where verified necessary.

Hi-fi mockup of the diagnostic surfaces (approved): artifact `e5476c35-19d3-4fb0-bc5a-3411b0631b5f`.

## Locked decisions (user, 2026-06-24)
1. **IA** = Command Center landing + **Diagnostics sub-hub** (Delta · Timeline · Lifecycle) + sibling
   Monetization, Retention, Alerts. Portfolio = Command Center in **"All games"** mode (not a separate page).
2. **/ops** — absorb its **Overview trends** into Command Center; leave Members/Care standalone (CS-oriented).
3. **Alerting** — in-app first (reuse notifications + `NotificationBell`), behind the abstract
   `notification-driver` seam so Slack/email slot in later. No Slack/email driver in v1.
4. **Data gaps** — **Phase 0 verifies first**: lifecycle-state derivation, SKU/pack columns, cross-game KPI parity.

## Target IA
```
LiveOps  (nav section, revived/elevated)
├─ Command Center   /liveops              KPI strip + high-sev anomaly strip + Ops overview trends
│                                          + portfolio row (when game = "All games")
├─ Diagnostics      /liveops/diagnostics  [Delta decomposition | Event timeline | Lifecycle flow]
├─ Monetization     /liveops/monetization payer tiers · realized LTV-by-cohort · SKU/pack · concentration
├─ Retention        /liveops/retention    [Cohort grid]  (existing /liveops/cohort → alias)
└─ Alerts & Digests /liveops/alerts        [Anomaly inbox | Alert rules | Digests & schedule]
                                            (existing /liveops/anomalies → alias)
```

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 00 | [Verification & data readiness](phase-00-verification-and-data-readiness.md) | ✅ | — |
| 01 | [LiveOps shell, nav revival, Command Center](phase-01-shell-nav-command-center.md) | ✅ | 00 |
| 02 | [Delta decomposition (Diagnostics tab 1)](phase-02-delta-decomposition.md) | ✅ | 01 |
| 03 | [Shared annotation primitive + Event timeline (tab 2)](phase-03-annotation-event-timeline.md) | ✅ | 01 |
| 04 | [Lifecycle flow Sankey (tab 3)](phase-04-lifecycle-flow-sankey.md) | ✅ | 00,01 |
| 05 | [Monetization deep-dive](phase-05-monetization-deepdive.md) | ✅ | 00,01 |
| 06 | [Alerts & Digests hub + delivery seam](phase-06-alerts-digests-hub.md) | ☐ | 01 |
| 07 | [Portfolio (Command Center "All games")](phase-07-portfolio-all-games.md) | ☐ | 00,01 |
| 08 | [Tests, docs, design cross-check, rollout](phase-08-tests-docs-rollout.md) | ☐ | all |

## Reuse map (build-on, not rebuild)
- **Hub tabs** → `OpsConsole/ops-console-tabs.tsx` pattern.
- **Charts** → `Chat/components/assistant-chart-section.tsx` (universal renderer); `OpsConsole/ops-chart-artifact.ts`.
- **Breakdown bars** → `Segments/visuals/{segmented-bar,bar-list}.tsx`, `Segments/detail/cards/*composition*`.
- **Monetization** → `OpsConsole/members-top-payers.tsx`, `ops-overview-queries.ts`; cube `billing_detail.cash_charged_gross`, `mf_users.{ltv_total_vnd,payer_tier}`, `revenue_vnd_real`.
- **Lifecycle** → `Segments/compare/overlap-venn.tsx`, segment-membership lakehouse snapshot delta; recharts `Sankey` (available, unused) or hand-rolled SVG (mockup).
- **Portfolio** → `Header/use-game-context.ts`, `Segments/funnel-builder/cross-game-compare.tsx`, `/cubes` registry.
- **Alerts/digest** → anomaly detector `server/jobs/anomaly-detector.ts` + table (migration 009); `chat-service` notifications (`api/notifications.ts`, `services/notification-driver.ts`, `scheduler.ts`); `NotificationBell`; **move** `Catalog/digest/digest-page.tsx` → Alerts.
- **Nav** → `shell/sidebar/sidebar.tsx:176`, `Settings/use-visible-nav-items.ts`, `auth/feature-access.ts`.

## Key risks
- LiveOps nav is *already visible by default* — "revival" is restructure + a visibility self-check, not dead-code revive (see Phase 01).
- Lifecycle states are **not** a modeled Cube dimension; derivation strategy is a Phase 00 gate (Sankey blocks on it).
- Anomaly detector is **pull-only**; the anomaly→notification bridge is net-new (Phase 06).
- Cross-game KPI parity varies (cfm/jus richest); portfolio uses a verified common subset (Phase 00).
- `chat-service` scheduler is single-instance — digest cron must guard against multi-replica double-fire.

## Open questions
- Should the chat `diagnose` skill be invoked *from* the Delta/Timeline UI (handoff button) or kept parallel? (lean: handoff link, decided in Phase 02)
- Digest recipients: per-user only, or shareable team digests? (Phase 06 — default per-user)
