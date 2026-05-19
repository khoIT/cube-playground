/**
 * Pure helpers for filtering and sorting the segments library on the client.
 * Separated so it can be unit-tested without React.
 */

import type { Segment } from '../../../types/segment-api';
import type { LibraryFilter, LibrarySort } from './library-toolbar';

export interface LibraryQuery {
  query: string;
  filter: LibraryFilter;
  sort: LibrarySort;
}

export function filterAndSortSegments(
  segments: Segment[],
  q: LibraryQuery,
): Segment[] {
  const needle = q.query.trim().toLowerCase();

  const filtered = segments.filter((s) => {
    if (q.filter === 'live' && s.type !== 'predicate') return false;
    if (q.filter === 'static' && s.type !== 'manual') return false;
    if (needle.length > 0) {
      const hay = `${s.name} ${s.tags?.join(' ') ?? ''} ${s.cube ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (q.sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'size':
        return (b.uid_count ?? 0) - (a.uid_count ?? 0);
      case 'recent':
      default: {
        const ad = a.last_refreshed_at ?? a.updated_at;
        const bd = b.last_refreshed_at ?? b.updated_at;
        return new Date(bd).getTime() - new Date(ad).getTime();
      }
    }
  });

  return sorted;
}
