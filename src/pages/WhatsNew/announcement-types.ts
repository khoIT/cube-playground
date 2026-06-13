/**
 * Shared types for the What's New feature-announcement inbox.
 *
 * Announcements are authored as markdown files (one per release) with a small
 * frontmatter block; see announcement-frontmatter.ts for the parse. The `id` is
 * the stable slug the backend read-state keys on (announcement_reads).
 */

/** Visual + semantic class of a release entry — drives the tag pill colour. */
export type AnnouncementKind = 'new' | 'improved' | 'fix';

export interface Announcement {
  /** Stable slug (frontmatter `id`, else the filename) — the read-state key. */
  id: string;
  title: string;
  /** ISO date (YYYY-MM-DD); list is sorted on this, newest first. */
  date: string;
  kind: AnnouncementKind;
  /** Product area label, e.g. "Segments", "Catalog". */
  area: string;
  /** In-app route for the "Open →" deep link (optional). */
  deepLink?: string;
  /** Screenshot asset path (optional — a placeholder renders when absent). */
  image?: string;
  /** Markdown body (everything after the frontmatter block). */
  body: string;
}

/** An announcement decorated with this user's read-state for rendering. */
export interface AnnouncementWithReadState extends Announcement {
  read: boolean;
}
