/**
 * "Snapshot · 2h ago" pill for the Members tab summary row.
 *
 * The member list and its total are a frozen snapshot materialized by the last
 * refresh, while the headline Size card counts the live cohort — so the two can
 * legitimately diverge (live size can exceed the snapshot count between
 * refreshes). This stamp marks the list as point-in-time so that gap reads as
 * expected staleness, not a bug. Hidden when the segment has never refreshed.
 */

import { ReactElement } from 'react';
import { Clock } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Segment } from '../../../../types/segment-api';

export function MembershipFreshnessChip({ segment }: { segment: Segment }): ReactElement | null {
  const ts = segment.last_refreshed_at;
  if (!ts) return null;

  const when = new Date(ts);
  const relative = formatDistanceToNowStrict(when, { addSuffix: true });

  return (
    <span
      title={`Membership list refreshes daily. The Size card counts the live cohort and may be higher.\nList snapshot: ${when.toLocaleString()}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.6,
        background: 'var(--muted-soft)',
        color: 'var(--muted-ink)',
        border: '1px solid var(--border-card)',
        cursor: 'help',
        whiteSpace: 'nowrap',
      }}
    >
      <Clock size={12} aria-hidden />
      Snapshot · {relative}
    </span>
  );
}
