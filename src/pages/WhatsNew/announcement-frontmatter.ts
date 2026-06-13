/**
 * Minimal frontmatter parser for What's New release markdown.
 *
 * Each release file is `---\n<key: value lines>\n---\n<markdown body>`. We only
 * support the handful of scalar keys the inbox needs (id/title/date/kind/area/
 * deepLink/image), so a tiny hand-rolled parser beats pulling in gray-matter +
 * a YAML engine (YAGNI). Unknown keys are ignored; a file with no frontmatter
 * block is treated as all-body.
 *
 * Kept pure and dependency-free so it is unit-testable without Vite's glob.
 */

import type { Announcement, AnnouncementKind } from './announcement-types';

const KINDS: readonly AnnouncementKind[] = ['new', 'improved', 'fix'];

/** Split a raw file into its frontmatter map + the body below the block. */
export function splitFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, body: raw.trim() };

  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    // Strip surrounding quotes a careful author might add around a value.
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    data[key] = value;
  }
  return { data, body: match[2].trim() };
}

/**
 * Parse one release file into an Announcement. `slug` (the filename without
 * extension) is the id fallback when frontmatter omits `id`, and dates default
 * to the empty string (sorted last) rather than throwing on a malformed file.
 */
export function parseAnnouncement(raw: string, slug: string): Announcement {
  const { data, body } = splitFrontmatter(raw);
  const kind = KINDS.includes(data.kind as AnnouncementKind)
    ? (data.kind as AnnouncementKind)
    : 'new';
  return {
    id: data.id || slug,
    title: data.title || slug,
    date: data.date || '',
    kind,
    area: data.area || 'General',
    deepLink: data.deepLink || undefined,
    image: data.image || undefined,
    body,
  };
}

/** Sort newest-first by ISO date; ties fall back to title for stable order. */
export function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => (b.date.localeCompare(a.date)) || a.title.localeCompare(b.title));
}
