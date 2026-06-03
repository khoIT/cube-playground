# Code Review — sys-admin hub redesign (Access govern vs Activity observe)

Date: 2026-06-03 22:18 (GMT+7) · Reviewer: code-reviewer
Scope: 9 changed/new files (server 3, FE 6), ~1225 LOC new. Tests pass (727 server + 1629 FE), typecheck clean for in-scope files.

## Verdict
No blockers. Implementation meets all 5 acceptance criteria and the 7 specific checks. Findings are minor/nit only.

## Acceptance Criteria — all met
1. **Sessions derived, gap>60min, duration=last-first, 30d sparkline** — MET. `session-aggregator.ts:74-130`. Gap-based (`r.ts-prevTs > gapMs`, GAP_MIN=60), no schema change (reads `activity_events` via `queryActivity`), `durationMs=end-start`, sparkline = `WINDOW_DAYS` daily counts oldest→newest. Empty (non-throw) for unknown/sub-less/no-event users (`:82,:90`).
2. **Access tab fires no heavy buildUserActivity; one light /sessions?limit=1** — MET. `per-user-panel.tsx:43` calls only `/sessions?limit=1`; the heavy `buildUserActivity` fetch now lives in `activity-profile.tsx:47` (drill-in only). AccessControls (`access-controls.tsx`) does zero read fetches on selection — only mutate calls.
3. **Shareable sub-route /admin/observability/:email; resolveTab keeps tab active** — MET. `index.tsx:123` route; `resolveTab` (tab-shell.tsx) longest segment-boundary match → `/admin/observability/<email>` matches `observability` tab via `startsWith(path+'/')`, cannot mis-match `access`.
4. **Approve = ONE PATCH {status:'active',role}; Deny = PATCH {status:'disabled'}** — MET. `pending-approval-queue.tsx:34` single `patchAdminUser` call per action, exact payloads.
5. **Query shapes member-NAMES-only** — MET. Read path `parseQueryShape` returns persisted `{cubes,measures,dimensions}` only; write-side `projectQueryShape` (activity-store.ts:86) strips filters/values/UIDs/dateRange. No filter/value field surfaces in `SessionEvent.shape` or UI.

## Specific checks
- **(b) RBAC inheritance** — VERIFIED. `admin-activity.ts:36-37` re-declares `requireRole('admin')` + `requireFeature('admin')` at router scope; registered as encapsulated plugin (`index.ts:102`). `/sessions` is a route on the same plugin instance → both preHandlers apply. Backed by route tests asserting 401/403/200/404 on `/sessions` (admin-activity-route.test.ts:94-106).
- **(c) parseShape refactor behavior-identical** — VERIFIED. Old private `parseShape` (git 0d06dbf) and new exported `parseQueryShape` (activity-store.ts:129-138) are byte-identical logic: `!detailJson→null`, `JSON.parse` in try, `catch→null`. Same cast type. aggregator.ts now imports it; no behavior change.
- **(d) Design tokens / no hex / Inter** — PASS. Only hex literal in new files is `#fff` on brand button (`per-user-shared.tsx:101`) — the documented allowed exception. All colors/radii via `var(--*)`; fonts `var(--font-sans)`; status colors use semantic `--success/warning/destructive/info-soft|ink`. No px-only font drift. (Monospace stack on query shapes is intentional code-display, consistent with existing query-shape rendering.)
- **(e) React stale-guard on email-keyed fetches** — PASS. All three guard correctly: `activity-profile.tsx:41-55` (`stale` flag, resets state, cleanup), `per-user-panel.tsx:40-47` (IdentityHeader `stale` flag), `user-activity-profile.tsx:63-71` (`loadUser` returns cleanup that flips `stale`). Rapid user switching cannot race a stale response onto screen.
- **(f) File size** — mostly PASS. 8/9 files ≤159 LOC. `access-controls.tsx` = 295 LOC (over ~200 target) — see Minor-1.
- **(g) No plan-artifact refs in code comments** — PASS for new files. One pre-existing stray in a non-new file — see Nit-1.

## Findings

### Minor
- **M1 — access-controls.tsx 295 LOC (>200 target).** Holds 4 sub-components (RoleStatusEditor, WorkspaceGrantsSection, GameGrantsSection, FeatureAccessSection). Logically cohesive (all govern controls extracted verbatim from old PerUserPanel) and each sub-section is small; FeatureAccessSection (~100 LOC) is the natural extraction candidate if split later. Not blocking — extraction was the point of this phase and the file reads cleanly. Optional: pull FeatureAccessSection into `feature-access-section.tsx`.

### Nit
- **N1 — Hardcoded box-shadow ignores `--shadow-xs` token.** `per-user-shared.tsx:14` (`boxShadow: '0 1px 2px rgba(0,0,0,0.04)'`) and `user-activity-profile.tsx:39` (`'0 1px 2px rgba(0,0,0,0.06)'`) hardcode shadows. tokens.css defines `--shadow-xs` which adapts in dark mode (0.04→0.4 opacity, tokens.css:75,282). Hardcoded values stay faint in dark mode. NOT new drift — 24 src files use hardcoded `rgba(0,0,0)` shadows incl. the sibling pre-existing `cross-user-audit-panel.tsx`, so this matches established (imperfect) precedent. Optional cleanup: swap to `var(--shadow-xs)`.
- **N2 — Stray "Phase-4" comment ref.** `observability-tab.tsx:4` says "(Phase-4 aggregator)". Violates repo rule "no plan-artifact refs in comments". File is MODIFIED in this PR but the comment is pre-existing/untouched on that line. Trivial: drop "(Phase-4 aggregator)".
- **N3 — `limit` accepts non-integer.** `admin-activity.ts:62` `Number(req.query.limit)` allows `1.5` (finite) → passed through; `buildUserSessions` later `slice(0,1.5)` truncates harmlessly. Cosmetic; `Math.trunc` or `parseInt` would be tidier. No correctness/security impact.
- **N4 — IdentityHeader error collapses to loading sentinel.** `per-user-panel.tsx:45` `.catch` sets `sessions30=null`, same value as the loading state, so a failed sessions fetch renders "… sessions" indefinitely rather than an error/zero. Harmless for a vanity count; acceptable per the "timeline degrades silently" design.

## Positive observations
- Clean Access/Observe split achieves the perf goal: govern selection now does 1 light call vs the old heavy chat+segment+audit rollup. Real, measurable win.
- `parseQueryShape` extraction is a correct DRY move (read+aggregator share one tolerant parser) with a clear "unreachable but cheap insurance" rationale.
- Sessionizer is defensively bounded: SCAN_LIMIT=1000 caps cost, clock-skew/future-ts guarded by `idx<WINDOW_DAYS`, gap/limit inputs clamped (`:76-77`).
- Privacy boundary held end-to-end: server never emits filter values; FE `SessionEvent.shape` carries names only; explicit user-facing privacy note (activity-profile.tsx:153).
- Comments explain *why* (encapsulation rationale at admin-activity.ts:11-15, identity sub↔email mapping) without plan-artifact coupling.
- Stale-guard discipline is consistent and correct across all async surfaces — the riskiest part of this change, done right.

## Unresolved questions
- None blocking. Optional: confirm whether the project wants `--shadow-xs` adopted project-wide (would fix N1 here + 24 other files) or accepts hardcoded shadows as-is.

Status: DONE
