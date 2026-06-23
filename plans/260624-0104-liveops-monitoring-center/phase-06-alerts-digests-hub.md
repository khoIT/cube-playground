# Phase 06 — Alerts & Digests hub + delivery seam

**Priority:** P0 (closes the monitor loop) · **Status:** ☐ · Depends: 01

## Goal
Make `/liveops/alerts` the alerting home: **Inbox** (relocated anomaly inbox), **Alert rules**
(threshold/condition engine), **Digests & schedule** (relocated DigestPage, wired to scheduled in-app
delivery). Bridge anomaly detector → in-app notifications. In-app first, behind `notification-driver` seam.

## Key insights
- Big reuse: anomaly detector + table (migration 009) exist but are **pull-only**; notifications table + API + `NotificationBell` + abstract `notification-driver` exist with **no Slack/email driver**; `chat-service/services/scheduler.ts` (node-cron) + `server/jobs/cron-runner.ts` exist; `Catalog/digest/digest-page.tsx` is a **mock** to move + make real.
- v1 delivers to in-app notifications only; Slack/email are future drivers slotting into the same seam.

## Architecture
- **Inbox tab** = existing `anomaly-inbox` rendered inside the hub (route alias from Phase 01).
- **Anomaly→notification bridge**: in `anomaly-detector` upsert path, on a newly-opened high/med anomaly, enqueue a notification via `notification-driver` (dedup on (game,metric,ts); respect snooze; don't notify on re-reads).
- **Alert rules**: migration `071-alert-rules.sql` (id, owner, game, metric, comparator, threshold, window, channel, enabled). Rule engine evaluated on the existing cron tick; emits notifications via the driver. UI rule-builder reuses `SettingsTabs`/form patterns.
- **Digests**: move DigestPage + `useSubscriptions` into Alerts; migration `072-digest-subscriptions.sql` (owner, game, metrics[], cadence, channel, next_run_at). Scheduled job (register on `scheduler.ts`) composes a digest payload (KPIs + open anomalies + top deltas) → notification-driver. Guard single-instance double-fire (per-run idempotence row).

## Files
- Modify: `server/src/jobs/anomaly-detector.ts` (emit-notification hook), `chat-service/src/services/notification-driver.ts` (keep abstract; add in-app impl if missing).
- Create: `server/src/db/migrations/071-alert-rules.sql`, `072-digest-subscriptions.sql`; `server/src/routes/alert-rules.ts`, `server/src/services/alert-rule-engine.ts`, `server/src/jobs/digest-runner.ts` (or register on chat-service scheduler).
- Create FE: `src/pages/Liveops/alerts/index.tsx` (hub tabs), `.../alerts/alert-rules-tab.tsx`, `.../alerts/rule-editor.tsx`, `.../alerts/digests-tab.tsx`.
- Move: `src/pages/Catalog/digest/*` → `src/pages/Liveops/alerts/digests/` (update Catalog nav/route; leave redirect).

## Steps
1. Anomaly→notification bridge (dedup + snooze-aware) → verify it lands in `NotificationBell`.
2. Alert-rules migration + engine on cron tick + CRUD route + rule-builder UI.
3. Relocate DigestPage; make subscriptions real (migration) + digest composer + scheduled delivery (in-app) with single-instance guard.
4. Hub assembly: Inbox | Rules | Digests tabs; deep-link `?tab=inbox` from anomaly redirect.

## Success criteria
- [ ] New high-severity anomaly produces an in-app notification (deduped, snooze-respecting).
- [ ] A user-defined rule (e.g. "DAU WoW < −5%") fires a notification when breached.
- [ ] A daily digest subscription delivers an in-app digest at cadence; no double-fire across ticks.
- [ ] DigestPage lives under Alerts; Catalog route redirects; driver seam ready for Slack/email.

## Risks
- chat-service scheduler is single-instance → digest/rule jobs need a per-(sub,run-date) idempotence row (mirror snapshot heartbeat pattern).
- Notification spam → throttle per (owner,metric); batch low-severity into digest, not real-time.
