/**
 * Push-to-segment modal.
 * Two tabs: "Create new" persists a new segment; "Append to existing" merges
 * the selected uids into a chosen static segment.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Modal, Input, Select, Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import type { Query } from '@cubejs-client/core';
import type { Segment, SegmentInput } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { invalidateSegmentIds } from '../use-segment-ids';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { buildPredicateFromRows } from '../../../QueryBuilderV2/segments-save-bar/build-predicate-from-rows';
import { SliceScopeNote } from '../slice-scope/slice-scope-note';
import { summarizeSelection } from './selection-summary';
import {
  formatCategoricalValue,
  formatNumericScalar,
  parseColumnLabel,
} from './format-selection-summary';
import styles from '../segments.module.css';

type ModeTab = 'create' | 'append';

interface Props {
  open: boolean;
  /** Direct uid list (identity-uid mode). Ignored when resolveUids is provided. */
  uids: string[];
  rows: Record<string, unknown>[];
  cube: string | null;
  onClose: () => void;
  onCreated?: (segmentId: string) => void;
  /**
   * When set, called at submit time to materialize uids from selected cohort
   * rows via a follow-up Cube Query. Used for aggregated queries where the
   * Results table doesn't carry per-user identity values directly.
   */
  resolveUids?: () => Promise<string[]>;
  /**
   * Optional UI hint when in expansion mode — tells the user the uid count
   * is not yet known until materialization runs at submit.
   */
  expansionPending?: boolean;
  /**
   * Executed Cube Query the rows came from. Used to construct a predicate_tree
   * when the user chooses Live type — captures filters, dateRange, and per-row
   * cohort-dimension equality. Required for allowLive=true.
   */
  executedQuery?: Query | null;
  /**
   * Identity dimension for the target cube — excluded from the per-row equality
   * group when building a predicate tree (its values aren't part of the cohort
   * definition; they're the result the predicate resolves to).
   */
  identityField?: string | null;
  /**
   * Controls the Create-tab type buttons:
   *   - allowStatic=true  → "Static" snapshot of uid_list is offered
   *   - allowLive=true    → "Live" predicate-based segment is offered
   *
   * uid-mode (each result row IS a user) sets allowStatic=false to enforce
   * "push the whole predicate" — the segment refreshes against the query
   * filters instead of freezing the current uid snapshot.
   *
   * cohort/expansion-mode allows both: Static materializes the selected
   * cohorts' uids; Live captures the cohort predicate for cron refresh.
   */
  allowStatic?: boolean;
  allowLive?: boolean;
}

export function PushModal({
  open,
  uids,
  rows,
  cube,
  onClose,
  onCreated,
  resolveUids,
  expansionPending,
  executedQuery,
  identityField,
  allowStatic = true,
  allowLive = true,
}: Props): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  // Stamp new segments with the currently-picked game so they bind to the
  // tenant the user was looking at when they pushed — not the server-side
  // fallback (which would mis-attribute every push to the default game).
  const gameId = useActiveGameId();
  const [tab, setTab] = useState<ModeTab>('create');
  const [name, setName] = useState('');
  const initialType: 'manual' | 'predicate' = allowStatic ? 'manual' : 'predicate';
  const [type, setType] = useState<'manual' | 'predicate'>(initialType);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [staticSegments, setStaticSegments] = useState<Segment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const showSegmentToast = (segmentId: string, text: string): void => {
    const key = `segment-toast-${segmentId}`;
    message.open({
      type: 'success',
      key,
      duration: 6,
      content: (
        <span>
          {text}{' '}
          <a
            onClick={() => {
              message.destroy(key);
              history.push(`/segments/${segmentId}`);
            }}
          >
            {t('segments.push.viewSegment', { defaultValue: 'View' })}
          </a>
        </span>
      ),
    });
  };

  useEffect(() => {
    if (!open) return;
    setName('');
    setType(initialType);
    setTargetId(null);
    setTab('create');
    // Scope the append-target picker to the active game — a push from one
    // game's playground must not land in another game's static segment.
    segmentsClient
      .list({ owner: '*', type: 'manual', game_id: gameId })
      .then(setStaticSegments)
      .catch(() => {});
  }, [open, initialType, gameId]);

  // Force the available type when the other isn't allowed. Both flags off
  // is an invalid configuration callers must avoid — UI still defaults to
  // Live (predicate) in that case to surface the bug visibly.
  useEffect(() => {
    if (!allowLive && type === 'predicate') setType('manual');
    if (!allowStatic && type === 'manual') setType('predicate');
  }, [allowLive, allowStatic, type]);

  // Time dims appear twice in the row data — once bare (`active_daily.log_date`)
  // and once granularity-suffixed (`active_daily.log_date.week`) with identical
  // values. Skip the bare key in the summary and remember the granularity for
  // the suffixed key so we can render `2026-05-18 W21` instead of an ISO blob.
  const { excludeColumns, granularityByCol } = useMemo(() => {
    const exclude: string[] = [];
    const granularity: Record<string, string | undefined> = {};
    for (const td of executedQuery?.timeDimensions ?? []) {
      if (td.granularity) {
        exclude.push(td.dimension);
        granularity[`${td.dimension}.${td.granularity}`] = td.granularity;
      }
    }
    return { excludeColumns: exclude, granularityByCol: granularity };
  }, [executedQuery]);
  const summary = useMemo(
    () => summarizeSelection(rows, { excludeColumns }),
    [rows, excludeColumns],
  );
  const showValueCounts = summary.total > 1;

  // Preview the predicate the Live segment will save, so we can show the user
  // exactly which slice the monitor metrics will be scoped to. Mirrors the
  // predicateRows choice in handleCreate (uid-mode passes [], cohort-mode rows).
  const previewPredicate = useMemo(() => {
    if (type !== 'predicate' || !executedQuery || !identityField) return null;
    const predicateRows = allowStatic ? rows : [];
    return buildPredicateFromRows(executedQuery, predicateRows, identityField);
  }, [type, executedQuery, identityField, allowStatic, rows]);

  /**
   * Resolves the uid list to use for create/append. In identity mode this is
   * just the `uids` prop. In expansion mode the caller passes a `resolveUids`
   * callback that runs the materialization Cube Query at submit time.
   */
  const resolveUidList = async (): Promise<string[]> => {
    if (resolveUids) {
      const out = await resolveUids();
      return out;
    }
    return uids;
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      message.error(t('segments.push.errorNoName'));
      return;
    }
    setSubmitting(true);
    try {
      const finalUids = await resolveUidList();
      if (finalUids.length === 0) {
        message.error(t('segments.push.errorNoIdentity'));
        return;
      }
      // For Live segments, build the canonical predicate tree from the
      // executed query + selected cohort rows. The server translates it to
      // a Cube filter array and persists both — the warm uid_list above
      // gives the user an immediate count; the next scheduled refresh
      // re-resolves the predicate (rolling dateRange semantics).
      let predicateTree = null;
      if (type === 'predicate') {
        if (!executedQuery || !identityField) {
          message.error(
            t('segments.push.errorNoPredicateContext', {
              defaultValue: 'Live segments need the originating query — switch to Static or re-run the query.',
            }),
          );
          return;
        }
        // uid-mode Live (allowStatic=false): the predicate IS the query —
        // pass [] so we don't degenerate into `identity IN (uids)`.
        // cohort-mode: pass selected rows so the predicate captures the
        // chosen cohorts via OR-of-AND.
        const predicateRows = allowStatic ? rows : [];
        predicateTree = buildPredicateFromRows(executedQuery, predicateRows, identityField);
      }

      const input: SegmentInput = {
        name: name.trim(),
        type,
        cube: cube ?? null,
        uid_list: finalUids,
        predicate_tree: predicateTree,
        refresh_cadence_min: type === 'predicate' ? 60 : null,
        game_id: gameId,
      };
      const created = await segmentsClient.create(input);
      invalidateSegmentIds();
      showSegmentToast(created.id, t('segments.push.toastCreated'));
      onCreated?.(created.id);
      onClose();
    } catch (err) {
      const msg = err instanceof SegmentApiError ? err.message : (err as Error).message;
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppend = async () => {
    if (!targetId) {
      message.error(t('segments.push.appendPlaceholder'));
      return;
    }
    setSubmitting(true);
    try {
      const finalUids = await resolveUidList();
      const res = await segmentsClient.append(targetId, finalUids);
      showSegmentToast(targetId, t('segments.push.toastAppended', { count: finalUids.length }));
      onCreated?.(targetId);
      onClose();
      void res;
    } catch (err) {
      const msg = err instanceof SegmentApiError ? err.message : (err as Error).message;
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={open}
      onCancel={onClose}
      title={t('segments.push.title')}
      width={520}
      footer={null}
      destroyOnClose
    >
      <div className={styles.modalContent}>
        <div className={styles.modalTabs} role="tablist">
          {(['create', 'append'] as ModeTab[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={tab === m}
              className={[
                styles.modalTab,
                tab === m ? styles.modalTabActive : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setTab(m)}
            >
              {t(`segments.push.tabs.${m}`)}
            </button>
          ))}
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryHeading}>{t('segments.push.summary')}</div>
          <div>
            {expansionPending
              ? t('segments.push.summaryExpansion', {
                  count: rows.length,
                  defaultValue: '{{count}} cohort(s) selected — user_ids will be materialized at save',
                })
              : !allowStatic
              ? t('segments.push.summaryPredicate', {
                  count: uids.length,
                  defaultValue:
                    '{{count}} user_ids in current result — segment refreshes against the query predicate',
                })
              : t('segments.push.summaryCount', { count: uids.length })}
          </div>
          {(summary.categoricals.length > 0 || summary.numeric) && (
            <dl className={styles.summaryRows}>
              {summary.categoricals.map((c) => {
                const label = parseColumnLabel(c.column, granularityByCol);
                return (
                  <div key={c.column} className={styles.summaryRow}>
                    <dt className={styles.summaryRowLabel}>
                      {label.member}
                      {label.granularity && (
                        <span className={styles.summaryRowTag}>{label.granularity}</span>
                      )}
                    </dt>
                    <dd className={styles.summaryRowValue}>
                      {c.topValues
                        .map((v) => {
                          const text = formatCategoricalValue(v.value, label.granularity);
                          return showValueCounts ? `${text} (${v.count})` : text;
                        })
                        .join(', ')}
                    </dd>
                  </div>
                );
              })}
              {summary.numeric && (() => {
                const label = parseColumnLabel(summary.numeric.column, granularityByCol);
                return (
                  <div className={styles.summaryRow}>
                    <dt className={styles.summaryRowLabel}>
                      avg {label.member}
                    </dt>
                    <dd className={styles.summaryRowValue}>
                      {formatNumericScalar(summary.numeric.avg)}
                    </dd>
                  </div>
                );
              })()}
            </dl>
          )}
        </div>

        {tab === 'create' ? (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="seg-name">
                {t('segments.push.name')}
              </label>
              <Input
                id="seg-name"
                value={name}
                placeholder={t('segments.push.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t('segments.push.typeLabel')}</label>
              <div className={styles.typeChoices}>
                {allowStatic && (
                  <button
                    type="button"
                    className={[
                      styles.typeOption,
                      type === 'manual' ? styles.typeOptionActive : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setType('manual')}
                  >
                    <div className={styles.typeOptionTitle}>{t('segments.push.typeStatic')}</div>
                    <div className={styles.typeOptionHint}>{t('segments.push.typeStaticHint')}</div>
                  </button>
                )}
                {allowLive && (
                  <button
                    type="button"
                    className={[
                      styles.typeOption,
                      type === 'predicate' ? styles.typeOptionActive : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setType('predicate')}
                  >
                    <div className={styles.typeOptionTitle}>{t('segments.push.typeLive')}</div>
                    <div className={styles.typeOptionHint}>{t('segments.push.typeLiveHint')}</div>
                  </button>
                )}
              </div>
            </div>

            {type === 'predicate' && <SliceScopeNote predicate={previewPredicate} variant="create" />}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button type="primary" loading={submitting} onClick={handleCreate}>
                {t('segments.push.submitCreate')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>{t('segments.push.appendTarget')}</label>
              <Select
                value={targetId ?? undefined}
                placeholder={t('segments.push.appendPlaceholder')}
                onChange={(v) => setTargetId(v)}
                options={staticSegments.map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.uid_count})`,
                }))}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button type="primary" loading={submitting} onClick={handleAppend}>
                {t('segments.push.submitAppend')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
