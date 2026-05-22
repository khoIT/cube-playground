/**
 * Compact meta line under the Library title: "{n} segments · {users} users ·
 * last refresh {ago}". Replaces the 4-tile KPI strip from the previous design.
 */

import { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Segment } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface Props {
  segments: Segment[];
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function LibraryMetaLine({ segments }: Props): ReactElement {
  const { t } = useTranslation();

  const { segCount, userCount, lastRefresh } = useMemo(() => {
    let users = 0;
    let last: number | null = null;
    for (const s of segments) {
      users += s.uid_count ?? 0;
      const ts = s.last_refreshed_at ?? s.updated_at;
      if (ts) {
        const ms = new Date(ts).getTime();
        if (!Number.isNaN(ms) && (last == null || ms > last)) last = ms;
      }
    }
    return {
      segCount: segments.length,
      userCount: users,
      lastRefresh: last,
    };
  }, [segments]);

  const lastLabel = lastRefresh
    ? formatDistanceToNowStrict(new Date(lastRefresh), { addSuffix: true })
    : t('segments.library.meta.never', { defaultValue: 'never' });

  return (
    <p className={styles.libraryMeta}>
      <strong className={styles.libraryMetaStrong}>
        {t('segments.library.meta.segments', { defaultValue: '{{count}} segments', count: segCount })}
      </strong>
      <span aria-hidden> · </span>
      {t('segments.library.meta.users', { defaultValue: '{{count}} users', count: userCount, formatted: formatCount(userCount) })}
      <span aria-hidden> · </span>
      {t('segments.library.meta.lastRefresh', { defaultValue: 'last refresh {{when}}', when: lastLabel })}
    </p>
  );
}
