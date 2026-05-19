/** Library page — title block, KPI tiles, toolbar, segment table. */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { useHistory } from 'react-router-dom';
import { LibraryKpiTiles } from './library-kpi-tiles';
import { LibraryToolbar } from './library-toolbar';
import type { LibraryFilter, LibrarySort } from './library-toolbar';
import { LibrarySegmentRow } from './library-segment-row';
import { filterAndSortSegments } from './library-filter-sort';
import { ImportIdsModal } from './import-ids-modal';
import styles from '../segments.module.css';

export function LibraryView(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    segmentsClient
      .list({ owner: '*' })
      .then((rows) => {
        if (!cancelled) setSegments(rows);
      })
      .catch((err: SegmentApiError) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    if (!segments) return [];
    return filterAndSortSegments(segments, { query, filter, sort });
  }, [segments, query, filter, sort]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1>{t('segments.library.title')}</h1>
          <p>{t('segments.library.subtitle')}</p>
        </div>
      </header>

      <LibraryKpiTiles segments={segments ?? []} />

      <LibraryToolbar
        query={query}
        filter={filter}
        sort={sort}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onSortChange={setSort}
        onImport={() => setImportOpen(true)}
        onNew={() => history.push('/segments/new')}
      />

      <div className={styles.tableCard}>
        <div className={styles.tableHead} role="row">
          <span>{t('segments.library.columns.segment')}</span>
          <span>{t('segments.library.columns.type')}</span>
          <span>{t('segments.library.columns.lastRefresh')}</span>
          <span>{t('segments.library.columns.size')}</span>
          <span>{t('segments.library.columns.trend')}</span>
          <span>{t('segments.library.columns.owner')}</span>
          <span />
        </div>
        {error && <div className={styles.errorState}>{error}</div>}
        {!error && segments == null && (
          <div style={{ padding: 16 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        )}
        {!error && segments != null && filtered.length === 0 && (
          <div className={styles.emptyState}>{t('segments.library.empty')}</div>
        )}
        {!error && filtered.map((s) => (
          <LibrarySegmentRow key={s.id} segment={s} />
        ))}
      </div>

      <ImportIdsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCreated={() => setReloadKey((k) => k + 1)}
      />
    </main>
  );
}
