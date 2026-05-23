---
phase: 9
title: "Long tail (digest + saved views + workspaces)"
status: done
priority: P3
effort: "5d"
dependencies: [3, 5]
---

# Phase 9: Long tail (digest + saved views + workspaces)

## Overview

Polish phase. Adds Compass long-tail features: metric digest (subscribe + Slack/email previews + preferences), saved views, lightweight workspaces index, and notifications. Lowest-priority phase — ship after demo-core (P1-P4) is stable and user-validated.

## Requirements

**Functional:**
- Subscribe modal on metric/concept detail right rail (replaces P3 stub)
- Subscription stored in `~/.user-prefs.json` or backend (decide in implementation)
- Digest preview pages: `/catalog/digest` shows mocked Slack + Email previews per current subscriptions
- Save view modal on Explore (or any QueryBuilder view) → persists to user prefs
- Saved Views index page at `/catalog/saved-views` → list + click to reopen
- Workspaces index at `/catalog/workspaces` → light shell (full canvas deferred)
- Notifications page at `/catalog/notifications` → recent anomalies + edits + activity

**Non-functional:**
- All long-tail pages load < 500ms
- Persistence layer accepts offline writes (queue + flush)

## Architecture

```
src/pages/Catalog/digest/
├── digest-page.tsx                  # /catalog/digest
├── subscribe-modal.tsx              # opened from MetricDetail right rail
├── digest-slack-preview.tsx
├── digest-email-preview.tsx
├── digest-preferences.tsx
├── use-subscriptions.ts             # storage
└── __tests__/...

src/pages/Catalog/saved-views/
├── saved-views-page.tsx             # /catalog/saved-views
├── save-view-modal.tsx              # opened from QueryBuilder
├── use-saved-views.ts
└── __tests__/...

src/pages/Catalog/workspaces/
├── workspaces-page.tsx              # /catalog/workspaces — light shell
└── __tests__/...

src/pages/Catalog/notifications/
├── notifications-page.tsx           # /catalog/notifications
├── use-notifications.ts             # reads anomalies + activity
└── __tests__/...

src/shared/user-prefs/
├── user-prefs-store.ts              # localStorage / backend abstraction
└── types.ts
```

**Persistence:** v1 = localStorage namespaced by user. v2 = optional backend sync (decide later).

**Notifications source:** anomaly detector state (from P8) + business-metric edit activity (from registry git log if available, or stub).

## Related Code Files

**Create:** ~16 files (see Architecture)

**Modify:**
- Right rails (`right-rail.tsx`, `right-rail-concept.tsx`) — replace Subscribe stub
- QueryBuilder toolbar — "Save view" button (add in a non-intrusive slot)
- App routing — register 4 new routes

## Implementation Steps

1. **Build `user-prefs-store`** — localStorage adapter with namespace + JSON serialise.
2. **Build `use-subscriptions`** + `use-saved-views` + `use-notifications` over the store.
3. **Build Subscribe modal** — cadence picker (daily / weekly / on-anomaly) + channel picker (Slack / email — mocked, no real delivery).
4. **Build DigestPage** — render Slack + Email previews per current subscriptions. Static template fed by subscription metadata.
5. **Build Save View modal** + Saved Views index.
6. **Build Workspaces page** — light shell only: header + "Workspaces index" + add-workspace stub.
7. **Build Notifications page** — list anomalies + recent edits; clickable to navigate.
8. **Wire subscribe button** in right rails — opens modal, on confirm writes to store, toasts confirmation.
9. **Wire save-view button** in QueryBuilder toolbar.
10. **Test:** subscription roundtrip; saved view persists across reload; notifications page reads anomaly state from P8.

## Success Criteria

- [ ] Subscribe modal opens from MetricDetail right rail; on confirm, subscription stored
- [ ] DigestPage renders Slack + Email previews per subscriptions
- [ ] Save view modal works from QueryBuilder; saved views index shows entry; click reopens
- [ ] Workspaces page renders light shell
- [ ] Notifications page lists anomalies from P8
- [ ] All persistence survives page reload (localStorage)

## Risk Assessment

- **localStorage size limits** (~5MB) — fine for prefs, breaks if storing many large saved views. **Mitigation:** cap saved views at 100 per user; compress JSON.
- **Real Slack/email delivery out of scope** — only previews. **Mitigation:** make "demo only" copy explicit on the page.
- **Notifications conflict with browser notifications API.** **Mitigation:** rename to "Activity" if confusion arises.
- **Workspaces light shell may not be useful by itself** — could confuse users. **Mitigation:** gate behind a feature flag in v1; reveal when full canvas ships.
- **User prefs persistence backend** — v1 = localStorage only is acceptable for single-user dev. Multi-user prod requires backend sync.
- **Dependency on P8 anomaly detector** for Notifications content. **Mitigation:** show "No anomalies" placeholder if P8 not yet shipped.
