/// <reference types="vite/client" />
/**
 * Build the announcement list from the bundled release markdown files.
 *
 * Vite inlines every `releases/*.md` as a raw string at build time (same `?raw`
 * mechanism the Segment presets use for YAML). Adding a new release is just
 * dropping a markdown file here — no registry edit, no backend change. The
 * resulting list is the single source of truth shared by the page and the bell.
 */

import { parseAnnouncement, sortAnnouncements } from './announcement-frontmatter';
import type { Announcement } from './announcement-types';

// eager + ?raw → a map of { './releases/<file>.md': '<file contents>' }.
const rawFiles = import.meta.glob('./releases/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function slugFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/, '');
}

export const announcements: Announcement[] = sortAnnouncements(
  Object.entries(rawFiles).map(([path, raw]) => parseAnnouncement(raw, slugFromPath(path))),
);

export const announcementIds: string[] = announcements.map((a) => a.id);
