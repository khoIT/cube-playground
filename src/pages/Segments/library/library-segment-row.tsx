/** A single row in the Segments Library table. */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { LiveBadge, Tag } from '../visuals';
import { StatusPill } from '../status/status-pill';
import type { Segment } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface Props {
  segment: Segment;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatLastRefresh(value: string | null): string {
  if (!value) return '—';
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function LibrarySegmentRow({ segment }: Props): ReactElement {
  const { t } = useTranslation();

  return (
    <Link to={`/segments/${segment.id}`} className={styles.tableRow}>
      <div className={styles.segmentCell}>
        <span className={styles.segmentName}>{segment.name}</span>
        {segment.cube != null && (
          <span className={styles.segmentDesc}>{segment.cube}</span>
        )}
        {segment.tags?.length > 0 && (
          <div className={styles.segmentTags}>
            {segment.tags.slice(0, 4).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {segment.type === 'predicate' ? (
          <LiveBadge
            size="sm"
            intervalMin={segment.refresh_cadence_min ?? undefined}
          />
        ) : (
          <span className={styles.staticBadge}>{t('segments.library.filter.static')}</span>
        )}
        <StatusPill status={segment.status} reason={segment.broken_reason} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {formatLastRefresh(segment.last_refreshed_at ?? segment.updated_at)}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {formatCount(segment.uid_count)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>—</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {segment.owner}
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-tertiary)', textAlign: 'right' }}>
        ›
      </div>
    </Link>
  );
}
