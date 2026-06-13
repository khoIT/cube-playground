# What's New — feature-announcement inbox

Repurpose the topbar bell into a single "What's New" bell + popover peek that opens a
full `/whats-new` changelog-timeline page. Announcements are markdown files (no compose
UI this round); read-state is per-user, persisted server-side.

**Design:** Variant A (changelog timeline) — `visuals/whats-new-inbox-variants.html`.
**Decisions (user-confirmed):** merged single bell · markdown files per release · backend
per-user read state · each entry has deep-link + optional screenshot · bell = popover peek + "See all".

## Architecture

```
markdown release files (bundled via Vite)  ──►  Announcement[] (parsed, sorted)
                                                      │
server: announcement_reads(owner_id, id)  ──►  readIds[]  ──►  unread = all − read
                                                      │
                          ┌───────────────────────────┴───────────────┐
                   WhatsNewBell (popover peek + badge)        /whats-new page (timeline)
```

- **Content = source of truth in frontend bundle** (`import.meta.glob` of `*.md`), so no
  server round-trip for content. Server only stores *which ids a user has read*.
- **Owner identity** from the server's existing `authenticate` middleware (dev = bootstrap admin).

## Phases

| # | Phase | Status |
|---|-------|--------|
| 01 | Backend: read-state table + API | ✅ done (5/5 tests) |
| 02 | Frontend: content pipeline + timeline page + route | ✅ done |
| 03 | Merge bell (popover peek) + tests | ✅ done (9 FE tests, code-reviewed) |

- [phase-01-backend-read-state.md](phase-01-backend-read-state.md)
- [phase-02-frontend-content-and-page.md](phase-02-frontend-content-and-page.md)
- [phase-03-bell-merge-and-tests.md](phase-03-bell-merge-and-tests.md)

## Scope OUT (this round)
- No compose/admin authoring UI.
- No real screenshot binaries — entries render a styled placeholder when `image` absent.
- Anomaly inbox page logic untouched (only its topbar bell is removed; page still reachable by URL).
- chat-service notifications backend left intact (just no longer surfaced in the topbar).

## Key dependencies
- `react-markdown` + `remark-gfm` (already in deps).
- Server SQLite + numbered migrations (next: `052`), Fastify `app.register`.
- `react-router` v5 lazy routes in `src/index.tsx`.
