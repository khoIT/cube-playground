# Phase 02 — Frontend: content pipeline + timeline page + route

## Overview
Priority: P0. Status: pending. Markdown release files → parsed `Announcement[]`; render the
Variant A changelog-timeline page at `/whats-new`.

## Files to create
- `src/pages/WhatsNew/releases/2026-06-14-lakehouse-snapshot-inbox.md` (+ 3–4 more seeds)
- `src/pages/WhatsNew/announcements-content.ts` — glob + frontmatter parse → sorted `Announcement[]`
- `src/pages/WhatsNew/announcement-types.ts` — `Announcement`, `AnnouncementTag` types
- `src/api/announcements-client.ts` — `listReadIds()`, `markRead(ids)` (defensive, never throw)
- `src/pages/WhatsNew/use-announcements.ts` — merge content + read-state → `{ items, unreadCount, markRead, markAllRead, loading }`
- `src/pages/WhatsNew/index.tsx` — `WhatsNewPage` (timeline)
- `src/pages/WhatsNew/announcement-timeline-item.tsx` — one timeline card (kept <200 lines)

## Files to modify
- `src/index.tsx` — lazy import + `<Route exact path="/whats-new" component={WhatsNewPage} />`.

## Content model
Frontmatter per `.md`:
```
---
id: lakehouse-snapshot-inbox
title: Lakehouse Snapshot Inbox
date: 2026-06-14
kind: new            # new | improved | fix
area: Segments
deepLink: /admin?tab=segment-refreshes
image: /whats-new/lakehouse-snapshot.png   # optional
---
<markdown body>
```
- `announcements-content.ts`: `import.meta.glob('./releases/*.md', { query:'?raw', eager:true })`,
  hand-rolled minimal frontmatter parser (key:value + the known fields — NO new dep), sort by date desc.
- `id` defaults to filename slug if frontmatter omits it.

## Page (Variant A)
- Mirror `src/pages/Liveops/anomaly-inbox/index.tsx` header + token styling and
  `docs/design-guidelines.md` page-header pattern (icon + 20px/700 title, eyebrow, maxWidth ~900, centered).
- Vertical timeline rail; each item: unread dot, `kind`+`area` tag pills (semantic soft/ink tokens),
  date, title, `react-markdown` body (remark-gfm), optional screenshot thumbnail (styled placeholder
  when `image` missing/fails to load), "Open <area> →" deep-link (react-router `Link`) + "Mark read".
- "All / Unread" filter + "Mark all read". Opening the page marks visible-as-seen? No — explicit only
  (Mark read / Mark all read), so the badge is user-controlled. Loading + empty states.

## Success criteria
- `/whats-new` renders seeded entries newest-first; markdown + tags + deep links work.
- Unread count = entries whose id ∉ readIds; Mark read / Mark all read update it and persist via API.
- Tokens only (no inline hex); files <200 lines; typecheck clean.

## Tests
- frontmatter parser: parses fields, slug fallback, sorts desc.
- `use-announcements`: unread computation, markRead removes from unread, markAll → 0 (mock client).
- page render: shows titles, tag, deep link href (RTL).
