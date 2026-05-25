/**
 * Library page — compact title block, meta line, filter pills, toolbar,
 * and segment table. KPI strip removed; trend column + sparkline added.
 *
 * State (filter/sort/search) is mirrored to the URL via useLibraryUrlState so
 * a refresh preserves the user's working set. Multi-select adds a sticky
 * bulk-actions toolbar above the table.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox } from 'antd';
import { Upload } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { LibraryToolbar } from './library-toolbar';
import { LibraryFilterPills } from './library-filter-pills';
import { LibraryMetaLine } from './library-meta-line';
import { LibrarySegmentRow } from './library-segment-row';
import { filterAndSortSegments } from './library-filter-sort';
import { ImportIdsModal } from './import-ids-modal';
import { useRefreshLogs } from './use-refresh-logs';
import { useLibraryUrlState } from './use-library-url-state';
import { BulkActionsToolbar } from './bulk-actions-toolbar';
import styles from '../segments.module.css';

export function LibraryView(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const gameId = useActiveGameId();
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const { query, filter, sort, setQuery, setFilter, setSort } = useLibraryUrlState();

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

  // Prune selection to only currently visible rows whenever the filtered set changes.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      let mutated = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else mutated = true;
      }
      return mutated ? next : prev;
    });
  }, [visibleIds]);

  const selectedSegments = useMemo(
    () => filtered.filter((s) => selected.has(s.id)),
    [filtered, selected],
  );
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const partiallySelected = selected.size > 0 && !allVisibleSelected;

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of segments ?? []) {
      for (const t of s.tags ?? []) set.add(t);
    }
    return Array.from(set).sort();
  }, [segments]);

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  const triggerReload = () => setReloadKey((k) => k + 1);

  return (
    <main className={styles.page}>
      <header className={styles.libraryHeader}>
        <LibraryMetaLine segments={segments ?? []} />
        <div className={styles.libraryActions}>
          <Button size="small" icon={<Upload size={14} />} onClick={() => setImportOpen(true)}>
            {t('segments.library.import')}
          </Button>
          <Button
            size="small"
            onClick={() => history.push('/segments/new/funnel')}
          >
            {t('segments.library.newFunnel', { defaultValue: 'New funnel' })}
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => history.push('/segments/new')}
          >
            {t('segments.library.new')}
          </Button>
        </div>
      </header>

      <div className={styles.filterBar}>
        <LibraryFilterPills
          segments={segments ?? []}
          filter={filter}
          onChange={setFilter}
        />
        <div className={styles.filterBarSpacer} />
        <LibraryToolbar
          query={query}
          sort={sort}
          onQueryChange={setQuery}
          onSortChange={setSort}
        />
      </div>

      {selected.size > 0 && (
        <BulkActionsToolbar
          selected={selectedSegments}
          onClear={() => setSelected(new Set())}
          onChanged={() => {
            setSelected(new Set());
            triggerReload();
          }}
          knownTags={knownTags}
        />
      )}

      <div className={styles.tableCard}>
        <div className={styles.tableHead} role="row">
          <div className={styles.rowCheckCell}>
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={partiallySelected}
              onChange={toggleAll}
              disabled={filtered.length === 0}
              aria-label="Select all visible"
            />
          </div>
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
          <div className={styles.emptyState}>
            <p className={styles.emptyStateText}>{t('segments.library.empty')}</p>
            <div className={styles.emptyStateCtas}>
              <Button icon={<Upload size={14} />} onClick={() => setImportOpen(true)}>
                {t('segments.library.import')}
              </Button>
              <Button
                type="primary"
                onClick={() => history.push('/segments/new')}
              >
                {t('segments.library.new')}
              </Button>
            </div>
          </div>
        )}
        {!error && filtered.map((s) => (
          <LibrarySegmentRow
            key={s.id}
            segment={s}
            log={logs[s.id]}
            selected={selected.has(s.id)}
            onToggleSelected={toggleOne}
            onChanged={triggerReload}
          />
        ))}
      </div>

      <ImportIdsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCreated={triggerReload}
      />
    </main>
  );
}
