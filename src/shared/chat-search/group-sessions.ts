/**
 * Pure helpers for the chat-search overlay:
 *   - groupSessions(): buckets a flat session list by calendar bucket
 *     (Today / Yesterday / Last 7 days / Last 30 days / Older).
 *   - formatTimeAgoLong(): the long-form "N hours ago" / "2 days ago"
 *     label used in the overlay rows (distinct from the compact "Nh ago"
 *     used in chat-page rails).
 *
 * Kept in /shared so any chat surface (sidebar, page, search) can reuse.
 */
import type { SessionSummary } from '../../pages/Chat/hooks/use-chat-sessions-list';

export type BucketKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'older';

export interface BucketLabel {
  key: BucketKey;
  label: string;
}

export const BUCKET_LABELS: BucketLabel[] = [
  { key: 'today',     label: 'TODAY' },
  { key: 'yesterday', label: 'YESTERDAY' },
  { key: 'last7',     label: 'LAST 7 DAYS' },
  { key: 'last30',    label: 'LAST 30 DAYS' },
  { key: 'older',     label: 'OLDER' },
];

/** Returns the bucket key for a given timestamp relative to `now`. */
export function bucketFor(ts: number, now: number): BucketKey {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(new Date(now));
  const yesterdayStart = todayStart - 24 * 3600 * 1000;
  const last7Start  = todayStart - 7  * 24 * 3600 * 1000;
  const last30Start = todayStart - 30 * 24 * 3600 * 1000;
  if (ts >= todayStart) return 'today';
  if (ts >= yesterdayStart) return 'yesterday';
  if (ts >= last7Start) return 'last7';
  if (ts >= last30Start) return 'last30';
  return 'older';
}

export interface GroupedSessions {
  key: BucketKey;
  label: string;
  sessions: SessionSummary[];
}

/**
 * Bucket sessions into ordered groups. Empty buckets are dropped. Within
 * each bucket the input order is preserved (server already sorts by
 * last_turn_at DESC, so this stays chronological).
 */
export function groupSessions(
  sessions: SessionSummary[],
  now: number = Date.now(),
): GroupedSessions[] {
  const byBucket: Record<BucketKey, SessionSummary[]> = {
    today: [], yesterday: [], last7: [], last30: [], older: [],
  };
  for (const s of sessions) {
    const iso = s.updatedAt ?? s.createdAt;
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) continue;
    byBucket[bucketFor(ts, now)].push(s);
  }
  return BUCKET_LABELS
    .filter((b) => byBucket[b.key].length > 0)
    .map((b) => ({ key: b.key, label: b.label, sessions: byBucket[b.key] }));
}

/**
 * Long-form relative time. Returns "" on invalid input so callers can
 * conditionally render.
 */
export function formatTimeAgoLong(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}
