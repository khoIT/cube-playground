/**
 * Floating action bar shown beneath QueryBuilderResults once the user has
 * checked one or more rows whose cube has a configured identity dimension.
 * Drives Clear / Copy IDs / Export CSV / Save as segment.
 *
 * Selection state is owned by QueryBuilderResults and passed in via props so
 * the checkbox column and this bar stay in sync.
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { PushModal } from '../../pages/Segments/push-modal/push-modal';
import type { ResultsSelectionApi } from './use-results-selection';

interface Props {
  cube: string | null;
  identityField: string | null;
  rows: Record<string, unknown>[];
  selection: ResultsSelectionApi;
}

function toCsv(uids: string[], identityField: string): string {
  const header = identityField;
  const body = uids.map((u) => (u.includes(',') || u.includes('"') ? `"${u.replace(/"/g, '""')}"` : u)).join('\n');
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
  cube,
  identityField,
  rows,
  selection,
}: Props): ReactElement | null {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  const selectedUids = selection.selectedUids;
  const selectedSet = useMemo(() => new Set(selectedUids), [selectedUids]);

  const selectedRows = useMemo(() => {
    if (!identityField) return [];
    return rows.filter((r) => {
      const v = r[identityField];
      return v != null && selectedSet.has(String(v));
    });
  }, [identityField, rows, selectedSet]);

  if (!identityField || selectedUids.length === 0) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedUids.join('\n'));
      message.success(t('segments.selectionBar.copied', { count: selectedUids.length, defaultValue: '{{count}} IDs copied' }));
    } catch {
      message.error(t('segments.selectionBar.copyFailed', { defaultValue: 'Clipboard unavailable' }));
    }
  };

  const handleExport = () => {
    const csv = toCsv(selectedUids, identityField);
    const safeCube = (cube ?? 'segment').replace(/[^a-z0-9_-]/gi, '_');
    downloadCsv(`${safeCube}-uids-${selectedUids.length}.csv`, csv);
  };

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
          {t('segments.selectionBar.selected', { count: selectedUids.length })}
        </span>
        <Button size="small" onClick={selection.clear}>
          {t('segments.selectionBar.clear')}
        </Button>
        <Button size="small" onClick={handleCopy}>
          {t('segments.selectionBar.copy')}
        </Button>
        <Button size="small" onClick={handleExport}>
          {t('segments.selectionBar.export')}
        </Button>
        <span style={{ flex: 1 }} />
        <Button type="primary" onClick={() => setModalOpen(true)}>
          {t('segments.selectionBar.saveAs')}
        </Button>
      </div>
      <PushModal
        open={modalOpen}
        uids={selectedUids}
        rows={selectedRows}
        cube={cube}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
