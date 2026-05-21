/**
 * Floating action bar shown beneath QueryBuilderResults once the user has
 * checked one or more rows whose cube has a configured identity dimension.
 * Drives Clear / Copy IDs / Export CSV / Save as segment.
 *
 * Two modes:
 *   - 'uid':       executed query already includes the identity dim. Each
 *                  selected row IS a user; selectedUids are the literal uids.
 *   - 'expansion': executed query targets a cube with identity configured,
 *                  but the identity dim isn't in the result columns. Selected
 *                  rows are cohorts; at push time a follow-up Cube Query
 *                  materializes the actual uids.
 *
 * Copy IDs / Export are only available in 'uid' mode (the uids exist
 * client-side already). In 'expansion' mode they're hidden — materialization
 * happens at save time inside PushModal.
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CubeApi, Query } from '@cubejs-client/core';
import { PushModal } from '../../pages/Segments/push-modal/push-modal';
import type { ResultsSelectionApi, GetRowKey } from './use-results-selection';
import { expandRowsToUids } from './expand-rows-to-uids';

export type SaveBarMode = 'uid' | 'expansion';

interface Props {
  mode: SaveBarMode;
  cube: string | null;
  identityField: string | null;
  rows: Record<string, unknown>[];
  selection: ResultsSelectionApi;
  getRowKey: GetRowKey;
  /** Original executed Cube Query — required for expansion mode. */
  executedQuery?: Query | null;
  /** Cube client used to run the expansion query at push time. */
  cubeApi?: CubeApi;
}

function toCsv(uids: string[], identityField: string): string {
  const header = identityField;
  const body = uids
    .map((u) => (u.includes(',') || u.includes('"') ? `"${u.replace(/"/g, '""')}"` : u))
    .join('\n');
  return `${header}\n${body}\n`;
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SegmentsSaveBar({
  mode,
  cube,
  identityField,
  rows,
  selection,
  getRowKey,
  executedQuery,
  cubeApi,
}: Props): ReactElement | null {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  const selectedKeys = selection.selectedUids;
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const selectedRows = useMemo(() => {
    return rows.filter((r) => {
      const k = getRowKey(r);
      return k != null && selectedSet.has(k);
    });
  }, [rows, getRowKey, selectedSet]);

  if (!identityField || selectedKeys.length === 0) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedKeys.join('\n'));
      message.success(
        t('segments.selectionBar.copied', {
          count: selectedKeys.length,
          defaultValue: '{{count}} IDs copied',
        }),
      );
    } catch {
      message.error(
        t('segments.selectionBar.copyFailed', { defaultValue: 'Clipboard unavailable' }),
      );
    }
  };

  const handleExport = () => {
    const csv = toCsv(selectedKeys, identityField);
    const safeCube = (cube ?? 'segment').replace(/[^a-z0-9_-]/gi, '_');
    downloadCsv(`${safeCube}-uids-${selectedKeys.length}.csv`, csv);
  };

  const resolveUids = mode === 'expansion'
    ? async (): Promise<string[]> => {
        if (!cubeApi || !executedQuery || !identityField) {
          throw new Error('Expansion mode requires cubeApi + executedQuery + identityField.');
        }
        return expandRowsToUids({
          cubeApi,
          originalQuery: executedQuery,
          selectedRows,
          identityField,
        });
      }
    : undefined;

  // In expansion mode the selectedKeys are row hashes, not real uids; pass an
  // empty `uids` to PushModal and rely on `resolveUids` at submit time.
  const uidsForModal = mode === 'uid' ? selectedKeys : [];

  return (
    <>
      <div
        role="region"
        aria-label="Selection actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-card)',
          fontSize: 13,
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>
          {mode === 'expansion'
            ? t('segments.selectionBar.cohortsSelected', {
                count: selectedKeys.length,
                defaultValue: '{{count}} cohort(s) selected — user_ids expand at save',
              })
            : t('segments.selectionBar.selected', { count: selectedKeys.length })}
        </span>
        <Button size="small" onClick={selection.clear}>
          {t('segments.selectionBar.clear')}
        </Button>
        {mode === 'uid' && (
          <>
            <Button size="small" onClick={handleCopy}>
              {t('segments.selectionBar.copy')}
            </Button>
            <Button size="small" onClick={handleExport}>
              {t('segments.selectionBar.export')}
            </Button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <Button type="primary" onClick={() => setModalOpen(true)}>
          {t('segments.selectionBar.saveAs')}
        </Button>
      </div>
      <PushModal
        open={modalOpen}
        uids={uidsForModal}
        rows={selectedRows}
        cube={cube}
        onClose={() => setModalOpen(false)}
        resolveUids={resolveUids}
        expansionPending={mode === 'expansion'}
        executedQuery={executedQuery ?? null}
        identityField={identityField}
        // Only expansion-mode pushes carry meaningful cohort dimensions —
        // uid-mode rows ARE the users, so a predicate would degenerate to
        // `identity IN (uids)` and add no value over the warm uid_list.
        allowLive={mode === 'expansion'}
      />
    </>
  );
}
