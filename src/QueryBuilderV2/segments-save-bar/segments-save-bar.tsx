/**
 * Floating action bar shown beneath QueryBuilderResults to drive segment
 * push from the current query result.
 *
 * Two display modes — fundamentally different UX:
 *
 *   - 'uid':       executed query already includes the identity dim, so each
 *                  row IS a user. No per-row selection — the WHOLE query is
 *                  pushed as a Live (predicate-based) segment that refreshes
 *                  against the query's filters + time range. Copy IDs and
 *                  Export CSV operate on all rows in the result.
 *
 *   - 'expansion': executed query targets a cube with identity configured,
 *                  but the identity dim isn't in the result columns. Rows are
 *                  cohorts; the user checkboxes a subset and a follow-up Cube
 *                  Query materializes the actual uids at push time. Both
 *                  Static (uid snapshot) and Live (predicate) are offered.
 *
 * Edit mode (segment round-trip):
 *   When QueryBuilderContainer resolves an ?edit-segment= context and injects
 *   it via SegmentEditSessionContext, the bar switches to edit mode:
 *     - Primary CTA becomes "Update <name>".
 *     - Secondary "Save as new" preserves the normal create path.
 *     - Update is disabled when the query contains operators that
 *       buildPredicateFromRows cannot translate (translatability gate).
 *     - Echo filters injected by the deeplink are stripped by exact
 *       structural match before the predicate is built — so game-scoping
 *       filters are never persisted into the segment definition.
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button, Modal, Tooltip, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CubeApi, Query } from '@cubejs-client/core';
import { PushModal } from '../../pages/Segments/push-modal/push-modal';
import {
  extractUid,
  type ResultsSelectionApi,
  type GetRowKey,
} from './use-results-selection';
import { expandRowsToUids } from './expand-rows-to-uids';
import { checkTranslatability } from './translatability-gate';
import { stripEchoFilters } from './echo-filter-stripper';
import { useSegmentUpdateAction } from './use-segment-update-action';
import { useSegmentEditSession } from '../../components/PlaygroundQueryBuilder/segment-edit-react-context';

export type SaveBarMode = 'uid' | 'expansion';

interface Props {
  mode: SaveBarMode;
  cube: string | null;
  identityField: string | null;
  rows: Record<string, unknown>[];
  selection: ResultsSelectionApi;
  getRowKey: GetRowKey;
  /** Original executed Cube Query — required for expansion mode + uid-Live. */
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
  const [confirmManualOpen, setConfirmManualOpen] = useState(false);

  // Reads the active segment-edit session injected by QueryBuilderContainer.
  // Null when the playground is in normal exploration mode.
  const editSession = useSegmentEditSession();
  const { updating, executeUpdate } = useSegmentUpdateAction(
    executedQuery ?? null,
    identityField,
    editSession,
  );

  // uid-mode: pushed/exported set is ALL uids in the result (no row selection).
  // expansion-mode: pushed set is only the user-checked cohort rows.
  const allUids = useMemo(() => {
    if (mode !== 'uid' || !identityField) return [];
    return rows
      .map((r) => extractUid(r, identityField))
      .filter((u): u is string => u != null);
  }, [mode, identityField, rows]);

  const selectedKeys = selection.selectedUids;
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const selectedRows = useMemo(() => {
    if (mode !== 'expansion') return [];
    return rows.filter((r) => {
      const k = getRowKey(r);
      return k != null && selectedSet.has(k);
    });
  }, [mode, rows, getRowKey, selectedSet]);

  // Translatability gate: check whether the current executed query (after
  // echo stripping) can be fully round-tripped through buildPredicateFromRows.
  // Memoised so it doesn't recompute on every render.
  const translatability = useMemo(() => {
    if (!editSession || !executedQuery) return null;
    const stripped = stripEchoFilters(executedQuery, editSession.editContext.echoFilters);
    return checkTranslatability(stripped);
  }, [editSession, executedQuery]);

  if (!identityField) return null;

  // uid: visible whenever the result has rows. expansion: visible only after
  // the user has selected at least one cohort row.
  const visible = mode === 'uid' ? rows.length > 0 : selectedKeys.length > 0;
  if (!visible) return null;

  // Drive Copy / Export from the mode-appropriate uid set.
  const exportUids = mode === 'uid' ? allUids : selectedKeys;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportUids.join('\n'));
      message.success(
        t('segments.selectionBar.copied', {
          count: exportUids.length,
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
    const csv = toCsv(exportUids, identityField);
    const safeCube = (cube ?? 'segment').replace(/[^a-z0-9_-]/gi, '_');
    downloadCsv(`${safeCube}-uids-${exportUids.length}.csv`, csv);
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

  const handleUpdate = () => {
    if (!editSession) return;
    if (editSession.segmentType === 'manual') {
      // Conversion from fixed uid list to live predicate — show confirm first.
      setConfirmManualOpen(true);
    } else {
      void executeUpdate(segmentId);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // For PushModal:
  //   - uid-mode: uids = all result uids (warm cache); rows = all result rows.
  //     allowStatic=false → only Live (predicate) creation. The predicate is
  //     built from filters + time ranges (rows are dropped at predicate
  //     build time to avoid `identity IN (uids)` degeneration).
  //   - expansion-mode: uids=[] (materialized via resolveUids); rows =
  //     selected cohort rows. Both Static and Live offered.
  const uidsForModal = mode === 'uid' ? allUids : [];
  const rowsForModal = mode === 'uid' ? rows : selectedRows;
  const allowStatic = mode === 'expansion';
  const allowLive = true;

  // Edit-mode gate checks.
  const isEditMode = !!editSession;
  const gameMismatch = editSession?.gameMismatch ?? false;
  const canAdminister = editSession?.canAdminister ?? false;
  // While segmentType is null (fetch in-flight), allow update attempts —
  // the server will reject unauthorized operations anyway.
  const updateBlocked =
    gameMismatch ||
    (translatability != null && !translatability.ok);
  const updateTooltip = gameMismatch
    ? 'Switch to the correct game workspace before saving changes'
    : translatability && !translatability.ok
    ? `Cannot express: ${translatability.blockedReasons.slice(0, 3).join('; ')}`
    : undefined;

  const segmentName = editSession?.editContext.segmentName ?? '';
  const segmentId = editSession?.editContext.segmentId ?? '';
  // canAdminister is false while fetch is in-flight (null segmentType);
  // hide Update until we know the user has rights, to avoid a click that
  // will 403 immediately.
  const showUpdateButton = isEditMode && canAdminister;

  return (
    <>
      <div
        role="region"
        aria-label={isEditMode ? 'Segment update actions' : 'Selection actions'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-card)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>
          {mode === 'uid'
            ? t('segments.selectionBar.queryUids', {
                count: allUids.length,
                defaultValue:
                  '{{count}} user_ids in result — push the whole query as a Live segment',
              })
            : t('segments.selectionBar.cohortsSelected', {
                count: selectedKeys.length,
                defaultValue: '{{count}} cohort(s) selected — user_ids expand at save',
              })}
        </span>
        {mode === 'expansion' && (
          <Button size="small" onClick={selection.clear}>
            {t('segments.selectionBar.clear')}
          </Button>
        )}
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

        {isEditMode ? (
          <>
            {/* Secondary: Save as new — always available in edit mode */}
            <Button size="small" onClick={() => setModalOpen(true)}>
              {t('segments.selectionBar.saveAsNew', { defaultValue: 'Save as new' })}
            </Button>
            {/* Primary: Update the segment being refined — hidden until
                permission fetch confirms can_administer */}
            {showUpdateButton && (
              <Tooltip title={updateTooltip} placement="topRight">
                <Button
                  type="primary"
                  loading={updating}
                  disabled={updateBlocked}
                  onClick={handleUpdate}
                >
                  {t('segments.selectionBar.updateSegment', {
                    name: segmentName,
                    defaultValue: `Update "${segmentName}"`,
                  })}
                </Button>
              </Tooltip>
            )}
          </>
        ) : (
          <Button type="primary" onClick={() => setModalOpen(true)}>
            {t('segments.selectionBar.saveAs')}
          </Button>
        )}
      </div>

      {/* Manual→live conversion confirm dialog */}
      <Modal
        visible={confirmManualOpen}
        title="Convert to Live segment?"
        okText="Yes, update"
        cancelText="Cancel"
        onOk={async () => {
          setConfirmManualOpen(false);
          await executeUpdate(segmentId);
        }}
        onCancel={() => setConfirmManualOpen(false)}
        okButtonProps={{ loading: updating }}
      >
        <p>
          If this segment was created manually (fixed user list), saving these changes will
          convert it to a <strong>Live</strong> (predicate-based) segment. The fixed user list
          will be replaced by a live query that refreshes automatically.
        </p>
        <p>This cannot be undone without manually re-entering the original user list.</p>
      </Modal>

      {/* Create-new modal — used for both normal mode and "Save as new" in edit mode */}
      <PushModal
        open={modalOpen}
        uids={uidsForModal}
        rows={rowsForModal}
        cube={cube}
        onClose={() => setModalOpen(false)}
        resolveUids={resolveUids}
        expansionPending={mode === 'expansion'}
        executedQuery={executedQuery ?? null}
        identityField={identityField}
        allowStatic={allowStatic}
        allowLive={allowLive}
      />
    </>
  );
}
