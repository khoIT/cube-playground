/**
 * useAnnouncements — shared state for the What's New inbox.
 *
 * Announcement CONTENT is static (bundled markdown); only READ-STATE is dynamic
 * and per-user. A module-level store holds the read-id set so the topbar bell
 * and the /whats-new page render one consistent unread count and stay in sync
 * when either marks something read — and the read-state is fetched from the
 * server only once per session, not once per mounting component.
 *
 * Marks are optimistic: the UI updates immediately, then the POST persists. A
 * failed POST is swallowed by the client (badge simply won't survive a reload),
 * which is the right trade-off for a non-critical "what's new" signal.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { announcements, announcementIds } from './announcements-content';
import { listReadAnnouncementIds, markAnnouncementsRead } from '../../api/announcements-client';
import type { AnnouncementWithReadState } from './announcement-types';

let readIds = new Set<string>();
let loaded = false;
let loading = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function snapshotKey(): string {
  // useSyncExternalStore needs a stable reference per state; a compact string
  // key (loaded flag + sorted ids) changes only when the set actually changes.
  return `${loaded ? 1 : 0}:${[...readIds].sort().join(',')}`;
}

async function ensureLoaded(): Promise<void> {
  if (loaded || loading) return;
  loading = true;
  const ids = await listReadAnnouncementIds();
  readIds = new Set(ids);
  loaded = true;
  loading = false;
  emit();
}

function applyRead(ids: string[]): void {
  let changed = false;
  for (const id of ids) {
    if (!readIds.has(id)) {
      readIds.add(id);
      changed = true;
    }
  }
  if (changed) {
    readIds = new Set(readIds); // new ref so the store key changes
    emit();
    void markAnnouncementsRead(ids); // persist; client swallows failures
  }
}

export interface UseAnnouncementsResult {
  items: AnnouncementWithReadState[];
  unreadCount: number;
  loaded: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export function useAnnouncements(): UseAnnouncementsResult {
  const key = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    snapshotKey,
    snapshotKey,
  );
  void key; // subscription trigger only — derived values read module state below

  useEffect(() => {
    void ensureLoaded();
  }, []);

  const markRead = useCallback((id: string) => applyRead([id]), []);
  const markAllRead = useCallback(() => applyRead(announcementIds), []);

  const items: AnnouncementWithReadState[] = announcements.map((a) => ({
    ...a,
    read: readIds.has(a.id),
  }));
  const unreadCount = loaded ? items.filter((i) => !i.read).length : 0;

  return { items, unreadCount, loaded, markRead, markAllRead };
}
