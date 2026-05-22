/** A single row in the Segments Library table. */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Tag } from '../visuals';
import { HealthCell } from './cells/health-cell';
import { TrendCell } from './cells/trend-cell';
import { DestinationsCell } from './cells/destinations-cell';
import { RowActionsMenu } from './row-actions-menu';
import type { RefreshLogRow, Segment } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface Props {
  segment: Segment;
  log?: RefreshLogRow[];
  onDeleted: (id: string) => void;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function LibrarySegmentRow({ segment, log, onDeleted }: Props): ReactElement {
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
      <HealthCell segment={segment} />
      <div className={styles.sizeCell}>{formatCount(segment.uid_count)}</div>
      <TrendCell log={log} isStatic={segment.type === 'manual'} />
      <DestinationsCell segment={segment} />
      <div className={styles.ownerCell}>{segment.owner}</div>
      <div className={styles.rowActionsCell}>
        <RowActionsMenu segment={segment} onDeleted={onDeleted} />
      </div>
    </Link>
  );
}
