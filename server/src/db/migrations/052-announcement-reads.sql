-- Per-user read receipts for the What's New feature-announcement inbox.
--
-- Announcements themselves are a broadcast: their content lives as bundled
-- markdown in the frontend, so there is no per-announcement row to own. We only
-- record WHICH announcement ids a given user has read. Unread is computed in the
-- client as (bundled ids − read ids), which keeps the server content-agnostic —
-- adding a new release markdown file needs no migration or backfill.
--
-- Keyed by (owner_id, announcement_id): one receipt per user per entry, written
-- the first time that user marks it read. announcement_id is the opaque slug
-- from the markdown frontmatter (e.g. 'lakehouse-snapshot-inbox').

CREATE TABLE IF NOT EXISTS announcement_reads (
  owner_id        TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  read_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, announcement_id)
);
