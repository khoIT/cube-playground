# What's New Feature-Announcement Inbox

**Date**: 2026-06-14 02:10
**Severity**: Medium
**Component**: Topbar, Notification System
**Status**: Shipped (c90a042)

## What Happened

Shipped a feature-announcement inbox merged into the topbar notification bell. The surface delivers markdown-based announcements (changelog, releases, onboarding tips) to all users with per-user read-state tracking. Investigation found the existing chat NotificationBell was wired end-to-end but never fired because emitMonitoringEvent({notify}) was never called anywhere — so consolidating two unused notification surfaces into one made architectural sense.

## The Brutal Truth

The decision to merge rather than add a third bell came from discovering a complete but ghost-haunted system: the chat-notifications table structure, read-state persistence, backend pagination — all built out, all unreachable because no upstream event ever existed. It would have been wasteful and architecturally messy to build a parallel third bell when two bells (AnomalyBell + NotificationBell) were already broken or unused. Merging forced a cleaner reckoning: use what exists or rip it out. We chose to reuse the read-state plumbing and replace the content model.

## Technical Details

**Content Model Decision:**
- Announcements are BROADCAST (all users see same set), but chat-notifications is per-owner rows (wrong shape for shared content).
- Chose: markdown files as source of truth (bundled via Vite `?raw` glob import). Adding a release needs no migration or backfill — just drop a .md file in `public/whats-new/`, rebuild, deploy.
- Read receipts stored in tiny `announcement_reads(owner_id, announcement_id)` table. Unread computed client-side as (bundled_ids − fetched_read_ids). Server stays content-agnostic.

**Deduplication & State Sharing:**
- Module-level `useSyncExternalStore` hook shares read-state between bell badge + inbox page. Both components subscribe to same store; fetch happens once per session via `GET /api/user/announcement-reads`. No badge/page disagreement possible.

**Design-to-Code:**
- Designed 3 hi-fi HTML inbox variants in huashu; user selected timeline-changelog layout.
- Welcome entry gets hand-built SVG hero (`public/whats-new/welcome.svg`) since real screenshots don't exist yet. Entries without images fall back to styled placeholder (light gray box).

**Blast Radius Control:**
- Old AnomalyBell files + chat-notifications backend left untouched, unsurfaced. Future dead-code sweep flagged; no rip-and-replace risk now.

## What We Tried

1. **Initial approach:** Add third bell (What's New) alongside Anomaly + Chat. Rejected after code-review feedback: confusing UX, redundant plumbing.
2. **Investigation:** Traced why chat NotificationBell icon never showed badges. Found: no caller of `emitMonitoringEvent({notify})` in any turn pipeline. Chat bell was complete skeleton, never fed data.
3. **Decision:** Merge What's New into chat bell, repurpose the read-state table, keep backend dormant. Cleaner UX (one bell), reuses verified plumbing.

## Root Cause Analysis

The chat notification system was a victim of incomplete feature delivery: backend and table schema existed, frontend wired correctly, but the event emitter was never integrated into any chat turn event-handling path. This isn't a bug — it's a design artifact. Rather than debug "why notifications never fired," recognizing the shape was salvageable saved 2–3 days of chasing the emission problem.

## Lessons Learned

1. **Merged systems beat orphaned plumbing.** When discovering unused but correctly-wired infrastructure (chat-notifications backend, read-state table), repurposing beats leaving it dormant. One bell + shared state < three bells with scattered ownership.

2. **Content model mismatches are architecture decisions.** BROADCAST announcements don't fit per-owner rows. Inverting to "files are truth, table holds receipts" eliminated migrations and kept the feature content-agnostic. This pattern scales if we add more announcement types later.

3. **Design-variants-first unblocks decisions fast.** Three huashu variants (grid, timeline, card-stack) let user pick in 30 minutes. Building React to ask "which layout?" after code costs 10x more.

4. **Scope guards (unsurfaced + flagged) lower risk.** Leaving old files + AnomalyBell intact meant zero refactoring; future sweep is explicit, not implicit debt. Reduces merge-conflict surface during concurrent work.

5. **Dark-mode unsafe hex in generated images is easy to miss.** Screenshot placeholder used raw `#f0f0f0` for background. In dark mode, invisible. Code-review caught it; added `var(--bg-muted)` fallback. Always test placeholder states.

## Verification

- **Backend:** 5/5 tests (announcement-reads CRUD, per-session fetch, ownership isolation).
- **Frontend:** 9/9 tests (store initialization, badge sync, page/bell agreement, markdown parsing, fallback rendering).
- **Integration:** 42/42 shell tests (full topbar suite, no regression).
- **Code-review:** Approved with nits (fixed dark-mode placeholder, verified SVG aspect ratio matches 16:9 design).

## Next Steps

- [ ] Monitor announcement-reads table for schema drift (if entries added frequently, may need archival strategy).
- [ ] Remove chat-notifications backend in a future cleanup pass (currently unsurfaced, not breaking anything).
- [ ] Add subscriber count + read percentage metrics to admin dashboard.
- [ ] Document announcement authoring guide for content team (markdown structure, image sizing, required frontmatter).

**Status:** SHIPPED

---

**Commit:** c90a042 | **Branch:** main | **Pushed:** origin + second remote
