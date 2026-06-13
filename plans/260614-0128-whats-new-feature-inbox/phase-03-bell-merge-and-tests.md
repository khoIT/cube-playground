# Phase 03 — Merge bell (popover peek) + tests + finalize

## Overview
Priority: P0. Status: pending. Collapse the two topbar bells into one What's New bell:
badge = unread announcements; click = popover peek of recent titles + "See all" → `/whats-new`.

## Files to create
- `src/pages/WhatsNew/whats-new-bell.tsx` — bell + antd `Popover` peek (mirror existing
  `notification-bell.tsx` popover idiom), badge from `use-announcements().unreadCount`,
  rows = recent titles (title, area, date, unread dot), footer "See all →" `Link` to `/whats-new`.
- `src/pages/WhatsNew/__tests__/whats-new-bell.test.tsx`

## Files to modify
- `src/shell/topbar/topbar.tsx` — replace `<AnomalyBell/>` + `<NotificationBell/>` with a single
  `<WhatsNewBell/>`. (Remove both imports.)

## Files to leave intact (scope guard)
- `src/shell/anomaly-bell.tsx` — kept on disk (page reachable by URL), just not in topbar.
- `src/components/Header/notification-bell.tsx` + chat-notifications backend — left as-is, unused
  in topbar. Note in completion report (no deletion this round to keep blast radius small).

## Behaviour
- Popover peek shows top ~6 announcements; clicking a row navigates to `/whats-new` (and may mark
  that id read). "See all →" always present. Badge hidden when unreadCount = 0.
- Reuse `use-announcements` so bell + page share one source (DRY); read-state fetched once on mount.

## Success criteria
- One bell in topbar; badge reflects unread; popover lists recent; "See all" routes to `/whats-new`.
- No regression: anomaly page still loads via `/liveops/anomalies`; chat-notification code still compiles.
- Full repo typecheck clean; new + touched tests pass.

## Finalize (cook gate)
- `code-reviewer` subagent (acceptance criteria, contracts, patterns, no new errors).
- `tester` subagent: run new tests + Admin/WhatsNew suites.
- `/ck:project-management` sync-back, `docs-manager` (design-guidelines / codebase-summary if warranted),
  offer commit via `git-manager`, `/ck:journal`.

## Open question
- Should clicking a popover row auto-mark that entry read, or only the explicit "Mark read" on the
  page? (Default: navigate only; page controls read-state. Confirm during review.)
