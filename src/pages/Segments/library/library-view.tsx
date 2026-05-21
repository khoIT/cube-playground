/**
 * Library page — compact title block, meta line, filter pills, toolbar,
 * and segment table. KPI strip removed; trend column + sparkline added.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { useHistory } from 'react-router-dom';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { LibraryToolbar } from './library-toolbar';
import type { LibrarySort } from './library-toolbar';
import { LibraryFilterPills } from './library-filter-pills';
import type { LibraryFilter } from './library-filter-pills';
import { LibraryMetaLine } from './library-meta-line';
import { LibrarySegmentRow } from './library-segment-row';
import { filterAndSortSegments } from './library-filter-sort';
import { ImportIdsModal } from './import-ids-modal';
import { useRefreshLogs } from './use-refresh-logs';
import styles from '../segments.module.css';

export function LibraryView(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const gameId = useActiveGameId();
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSegments(null);
    segmentsClient
      .list({ owner: '*', game_id: gameId })
      .then((rows) => {
        if (!cancelled) setSegments(rows);
      })
      .catch((err: SegmentApiError) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, gameId]);

  const filtered = useMemo(() => {
    if (!segments) return [];
    return filterAndSortSegments(segments, { query, filter, sort });
  }, [segments, query, filter, sort]);

  const visibleIds = useMemo(() => filtered.map((s) => s.id), [filtered]);
  const logs = useRefreshLogs(visibleIds, 7);

  return (
    <main className={styles.page}>
      <header className={styles.libraryHeader}>
        <div className={styles.libraryTitleRow}>
          <div className={styles.libraryTitleBlock}>
            <h1 className={styles.libraryTitle}>{t('segments.library.title')}</h1>
            <LibraryMetaLine segments={segments ?? []} />
          </div>
          <div className={styles.libraryActions}>
            <Button onClick={() => setImportOpen(true)}>{t('segments.library.import')}</Button>
            <Button type="primary" onClick={() => history.push('/segments/new')}>
              {t('segments.library.new')}
            </Button>
          </div>
        </div>
        <LibraryFilterPills
          segments={segments ?? []}
          filter={filter}
          onChange={setFilter}
        />
      </header>

      <LibraryToolbar
        query={query}
        sort={sort}
        onQueryChange={setQuery}
        onSortChange={setSort}
      />

      <div className={styles.tableCard}>
        <div className={styles.tableHead} role="row">
          <span>{t('segments.library.columns.segment')}</span>
          <span>{t('segments.library.columns.health', { defaultValue: 'Health' })}</span>
          <span>{t('segments.library.columns.size')}</span>
          <span>{t('segments.library.columns.trend')}</span>
          <span>{t('segments.library.columns.usedIn', { defaultValue: 'Used in' })}</span>
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
          <LibrarySegmentRow key={s.id} segment={s} log={logs[s.id]} />
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
