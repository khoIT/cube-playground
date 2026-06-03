# Sys-admin hub redesign — split Access (govern) from Activity (observe)

Status: Phases 1–4 + 6 IMPLEMENTED (2026-06-03) · Phase 5 deferred (optional) · Owner: khoitn · Created 2026-06-03

## Implementation status
- ✅ Phase 1 — `session-aggregator.ts` (gap=60min) + `/api/admin/activity/users/:email/sessions`; shared `parseQueryShape`. Tests: session-aggregator (8) + route (4).
- ✅ Phase 2 — split into `per-user-shared.tsx`, `access-controls.tsx`, `feature-access-section.tsx`, `session-timeline.tsx`, `activity-profile.tsx`; lean `per-user-panel.tsx` (Access tab drops heavy fetch, light `/sessions?limit=1` for count). Tests: per-user-panel (17) + activity-profile (8).
- ✅ Phase 3 — sub-route `/admin/observability/:email` + `user-activity-profile.tsx` (Access|Activity toggle); inactive rows link in; resolveTab drill-in test.
- ✅ Phase 4 — `pending-approval-queue.tsx` (Approve = one PATCH active+role; Deny = disabled) + dynamic "N pending" tab badge. Tests: pending-approval-queue (5) + observability-tab (7).
- ⏸️ Phase 5 — audit consolidation / retire Dev tab: DEFERRED (optional, pure relocation).
- ✅ Phase 6 — tests + code review (no blockers) + docs.

All suites green: 727 server + 1629 frontend. Review report: `plans/reports/review-260603-2218-user-access-redesign-report.md`.
Prototypes (open in browser):
- `user-access-redesign.html` — per-user detail v1 (all-in-one)
- `sysadmin-hub-split.html` — **target IA**: Access view · Observability overview · per-user Activity profile

## Goal

Separate the hub's two mental modes:
- **Users & Access** = govern (mutate): provision, role/status, workspace/game/feature grants. Write-heavy, task-oriented.
- **Observability** = observe (read): org health, pending queue, inactive triage, per-user session/activity drill-in. Read-only, investigative.

The per-user activity timeline (session history, query shapes, chat) moves OUT of the access panel and INTO Observability as the per-user drill-down — where it gets full width and the org overview can link into it.

## Why (grounded in current code)

- `src/pages/Admin/hub/per-user-panel.tsx` (745 lines) mixes write controls + read-only `ActivitySnapshot`. Every user selection fires the heavy `buildUserActivity` fetch (chat-service call + event queries) just to flip a role.
- `observability-tab.tsx` already exists but is org-only (`GET /api/admin/activity/summary`) — it dead-ends at KPIs + inactive list, no per-user drill-in.
- `cross-user-audit-panel.tsx` + `audit-log-viewer.tsx` live under a "Dev / Chat-Audit · relocated" tab — orphaned; audit is observation.
- Default-deny auto-creates `pending` rows (`auth/access-store-mutators.ts:ensurePendingUser`); approving them is the #1 recurring admin job but is buried behind a "Pending only" checkbox.

## Target architecture

```
Sys-admin hub
├── Users & Access      (/admin/access)         GOVERN
│   └── per-user CONTROL panel: identity + 1-line vitals strip + "View activity →"
│       Role&status · Workspace grants · Game grants · Feature access
├── Observability       (/admin/observability)  OBSERVE
│   ├── Overview: KPIs + PENDING-APPROVAL QUEUE + inactive triage + all-users (sparkline) list
│   └── per-user ACTIVITY profile (/admin/observability/:email)
│       identity + [Access | Activity] toggle + sparkline + vitals + session timeline + audit
└── (Dev / Chat-Audit tab retired → audit folds into Observability)
```

Shared per-user profile carries an `Access | Activity` segmented toggle (one subject, two lenses, one identity header — no duplication).

## Data: sessions are DERIVED, not newly logged

`activity_events` (append-only: `feature_open`, `query_run`, each timestamped) already exists. Sessionize by gap:
- events for one actor ordered by ts; a gap > 30 min starts a new session
- session duration = last − first event ts within the window
- "what they did" = the events inside the window (features + query shapes; chat turns joined by ts window from chat-service)
- 30-day sparkline = daily event counts; live presence = most-recent event < 5 min

No keystroke/content logging. Query shapes stay member-names-only (existing privacy allowlist). One new read query — no schema/logging change.

## Phases

### Phase 1 — Backend: session derivation (TDD)
- New `server/src/services/session-aggregator.ts`: `buildUserSessions(email, {limit=5, gapMin=60})` → `{ sessions: [{start, end, durationMs, events:[{ts, type, target|shape}]}], sessions30, avgDurationMs, sparkline:number[30] }`. Reuses `activity-store.queryActivity` + `parseShape`.
- Extend route `GET /api/admin/activity/users/:email` (or add `/sessions`) behind existing `requireRole('admin')`.
- Tests: gap boundary (59 vs 61 min), single-event session (dur 0), never-logged-in (empty), malformed shape tolerated.

### Phase 2 — Frontend: split per-user-panel into focused modules
- Extract `access-controls.tsx` (Role&status + Workspace + Game + Feature) and `activity-profile.tsx` (sparkline + vitals + session timeline + audit) from `per-user-panel.tsx` (keeps each <200 LOC).
- `users-and-access-tab.tsx` → renders identity + 1-line vitals strip + `access-controls` only. Drop the heavy activity fetch from this path.
- New `session-timeline.tsx` (ribbon + expandable events) per the prototype.

### Phase 3 — Observability per-user drill-in
- `observability-tab.tsx`: make KPI/inactive/all-users rows link to `/admin/observability/:email`.
- New `user-activity-profile.tsx`: identity + `Access | Activity` toggle (Access reuses Phase-2 `access-controls`); Activity = `activity-profile` + `session-timeline`.
- Route wiring in `hub/index.tsx` TabShell (deep-link `:email`).

### Phase 4 — Promote pending-approval queue
- Tab badge: count of `status='pending'` users.
- Observability overview: "Pending approval" card — per-row role select + Approve (sets active + role + default grants in one PATCH) + Deny (disabled). Reuses `patchAdminUser` / grant mutators.

### Phase 5 — Consolidate audit (optional, low-risk)
- Move `cross-user-audit-panel` + `audit-log-viewer` under Observability; retire the "Dev / Chat-Audit · relocated" tab. Pure relocation.

### Phase 6 — Tests + docs
- Component tests for split panels; route test for drill-in. Update `docs/` (system-architecture / codebase-summary) for the new IA. Cross-check against `docs/design-guidelines.md` (tokens, header pattern).

## Risks / mitigations
- **Sessionization cost** on busy users → cap event scan (e.g. last 30d, LIMIT), index on `(actor_sub, ts)` if missing.
- **Splitting a 745-line file** → extract incrementally; keep `per-user-panel-helpers.ts` as the shared pure-helper entry so existing tests keep importing from one place.
- **Route/deep-link regressions** → `resolveTab` already handles `/admin/access`; add `:email` resolution test.
- **Scope creep** → Phases 1–4 are the redesign; 5 is optional; ship 1–4 first.

## Decisions (locked 2026-06-03)
1. **Session gap = 1 hour** (no activity for 60 min → new session). `GAP_MIN = 60`, hardcoded const.
2. **Sub-route** `/admin/observability/:email` for drill-in (shareable URL + back-button). Add `:email` resolution + route test.
3. **Keep mini activity strip** on Access tab — one-line vitals (last login · status · session count) + "View activity →", sourced from the cheap summary, NOT `buildUserActivity`.
4. **30d total chat turns only** — reuse existing `chatStats.turns`; no per-session chat-service join.
