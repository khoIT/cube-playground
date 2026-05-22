/**
 * Filter pills for the Library: All / Live / Static / Broken with counts.
 * Replaces the inline filterTabs row inside library-toolbar.
 */

import { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../types/segment-api';
import styles from '../segments.module.css';

export type LibraryFilter = 'all' | 'live' | 'static' | 'broken';

interface Props {
  segments: Segment[];
  filter: LibraryFilter;
  onChange: (f: LibraryFilter) => void;
}

type PillDotTone = 'success' | 'destructive' | 'muted';

interface Pill {
  key: LibraryFilter;
  label: string;
  count: number;
  tone?: 'destructive';
  dotTone?: PillDotTone;
}

export function LibraryFilterPills({ segments, filter, onChange }: Props): ReactElement {
  const { t } = useTranslation();

  const counts = useMemo(() => {
    let live = 0;
    let staticCount = 0;
    let broken = 0;
    for (const s of segments) {
      if (s.type === 'predicate') live += 1;
      else staticCount += 1;
      if (s.status === 'broken') broken += 1;
    }
    return { all: segments.length, live, static: staticCount, broken };
  }, [segments]);

  const pills: Pill[] = [
    { key: 'all', label: t('segments.library.filter.all', { defaultValue: 'All' }), count: counts.all },
    { key: 'live', label: t('segments.library.filter.live', { defaultValue: 'Live' }), count: counts.live, dotTone: 'success' },
    { key: 'static', label: t('segments.library.filter.static', { defaultValue: 'Static' }), count: counts.static, dotTone: 'muted' },
    { key: 'broken', label: t('segments.library.filter.broken', { defaultValue: 'Broken' }), count: counts.broken, tone: 'destructive', dotTone: 'destructive' },
  ];

  return (
    <div className={styles.filterPills} role="tablist" aria-label="Segment filter">
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          role="tab"
          aria-selected={filter === p.key}
          className={[
            styles.filterPill,
            filter === p.key ? styles.filterPillActive : '',
            p.tone === 'destructive' && p.count > 0 ? styles.filterPillBroken : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onChange(p.key)}
        >
          {p.dotTone && (
            <span className={styles.filterPillDot} data-tone={p.dotTone} aria-hidden />
          )}
          {p.label}
          <span className={styles.filterPillCount}>{p.count}</span>
        </button>
      ))}
    </div>
  );
}
