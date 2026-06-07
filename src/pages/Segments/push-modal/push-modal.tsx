/**
 * Push-to-segment modal.
 * Two tabs: "Create new" persists a new segment; "Append to existing" merges
 * the selected uids into a chosen static segment.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Modal, Input, Select, Button, message, notification } from 'antd';
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
import { suggestSegmentName } from './suggest-segment-name';
import { PushModalReviewStep } from './push-modal-review-step';
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

  // Notification (not a small message toast) so the user can actually see
  // which segment was just created and has a real button to jump to it.
  // The WHOLE card is one self-contained row passed via `message` — antd's
  // stock icon/description/btn slots impose their own bulky layout, so we
  // bypass them entirely and only reskin the outer frame (.pushToast).
  const showSegmentToast = (
    segmentId: string,
    segmentName: string,
    text: string,
    meta?: string,
  ): void => {
    const key = `segment-toast-${segmentId}`;
    notification.open({
      key,
      duration: 8,
      className: styles.pushToast,
      message: (
        <div className={styles.pushToastRow}>
          <span className={styles.pushToastIcon}>✓</span>
          <span className={styles.pushToastText}>
            <span className={styles.pushToastTitle}>{text}</span>
            <span className={styles.pushToastName}>
              {segmentName}
              {meta && <span className={styles.pushToastMeta}> · {meta}</span>}
            </span>
          </span>
          <button
            type="button"
            className={styles.pushToastBtn}
            onClick={() => {
              notification.close(key);
              history.push(`/segments/${segmentId}`);
            }}
          >
            {t('segments.push.viewSegment', { defaultValue: 'View segment →' })}
          </button>
        </div>
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
      // Build the canonical predicate tree from the executed query + selected
      // cohort rows. The server translates it to a Cube filter array and
      // persists both.
      //   - Live: it IS the definition — refreshes re-resolve it (rolling
      //     dateRange semantics); the warm uid_list gives an immediate count.
      //   - Static: membership stays the frozen uid_list, but the slice is
      //     stored as context so detail cards report the cohort's defining
      //     window (matching a Live twin) instead of lifetime activity.
      let predicateTree = null;
      if (type === 'predicate' && (!executedQuery || !identityField)) {
        message.error(
          t('segments.push.errorNoPredicateContext', {
            defaultValue: 'Live segments need the originating query — switch to Static or re-run the query.',
          }),
        );
        return;
      }
      if (executedQuery && identityField) {
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
      showSegmentToast(
        created.id,
        created.name,
        t('segments.push.toastCreated'),
        `${type === 'predicate' ? t('segments.push.typeLive') : t('segments.push.typeStatic')} · ${finalUids.length.toLocaleString()} uids`,
      );
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
      showSegmentToast(
        targetId,
        staticSegments.find((s) => s.id === targetId)?.name ?? targetId,
        t('segments.push.toastAppended', { count: finalUids.length }),
      );
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

  // ✦ name suggestion + CTA phrasing, both derived from the selected cohort.
  const suggestion = suggestSegmentName(summary.categoricals, granularityByCol);
  const ctaLabel =
    type === 'predicate'
      ? t('segments.push.ctaCreateLive', { defaultValue: 'Create Live segment' })
      : t('segments.push.ctaCreateStatic', { defaultValue: 'Create static segment' });

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
        {tab === 'create' ? (
          <>
            {/* Guided rail: step 1 review → step 2 define. The numbered rail
                forces the eye through "what am I saving" before the form. */}
            <div className={styles.pushSteps}>
              <div className={styles.pushStep}>
                <div className={styles.pushRail}>
                  <div className={styles.pushRailDot}>1</div>
                  <div className={styles.pushRailLine} />
                </div>
                <div className={styles.pushStepBody}>
                  <div className={styles.pushStepTitle}>
                    {t('segments.push.step1Title', { defaultValue: 'Review what you selected' })}
                  </div>
                  <PushModalReviewStep
                    summary={summary}
                    granularityByCol={granularityByCol}
                    cube={cube}
                    executedQuery={executedQuery}
                    expansionPending={expansionPending}
                    uidCount={uids.length}
                  />
                </div>
              </div>

              <div className={styles.pushStep}>
                <div className={styles.pushRail}>
                  <div className={styles.pushRailDot}>2</div>
                </div>
                <div className={styles.pushStepBody} style={{ paddingBottom: 4 }}>
                  <div className={styles.pushStepTitle}>
                    {t('segments.push.step2Title', { defaultValue: 'Define the segment' })}
                  </div>
                  <div className={styles.pushNameRow}>
                    <Input
                      id="seg-name"
                      value={name}
                      placeholder={t('segments.push.namePlaceholder')}
                      onChange={(e) => setName(e.target.value)}
                    />
                    {suggestion && !name && (
                      <button
                        type="button"
                        className={styles.pushSuggestChip}
                        onClick={() => setName(suggestion)}
                        title={t('segments.push.suggestName', {
                          defaultValue: 'Use suggested name',
                        })}
                      >
                        ✦ {suggestion}
                      </button>
                    )}
                  </div>
                  <div className={styles.pushTypeRows} role="radiogroup">
                    {allowStatic && (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={type === 'manual'}
                        className={[
                          styles.pushTypeRow,
                          type === 'manual' ? styles.pushTypeRowActive : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => setType('manual')}
                      >
                        <span className={styles.pushRadio} />
                        <span>
                          <span className={styles.pushTypeTitle}>
                            {t('segments.push.typeStaticTitle', { defaultValue: 'Static snapshot' })}
                          </span>
                          <span className={styles.pushTypeHint} style={{ display: 'block' }}>
                            {t('segments.push.typeStaticHint')}
                          </span>
                        </span>
                      </button>
                    )}
                    {allowLive && (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={type === 'predicate'}
                        className={[
                          styles.pushTypeRow,
                          type === 'predicate' ? styles.pushTypeRowActive : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => setType('predicate')}
                      >
                        <span className={styles.pushRadio} />
                        <span>
                          <span className={styles.pushTypeTitle}>
                            {t('segments.push.typeLive')}
                            <span className={styles.pushLivePill}>
                              <span className={styles.pushLivePillDot} />
                              {t('segments.push.typeLivePill', { defaultValue: 'auto-refresh' })}
                            </span>
                          </span>
                          <span className={styles.pushTypeHint} style={{ display: 'block' }}>
                            {t('segments.push.typeLiveHint')}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                  {type === 'predicate' && (
                    <SliceScopeNote predicate={previewPredicate} variant="create" />
                  )}
                </div>
              </div>
            </div>

            <div>
              <Button
                type="primary"
                block
                loading={submitting}
                onClick={handleCreate}
                style={{ height: 36 }}
              >
                {suggestion ? `${ctaLabel} — ${suggestion}` : ctaLabel}
              </Button>
              <div className={styles.pushCtaSub}>
                {type === 'predicate'
                  ? t('segments.push.ctaLiveSub', {
                      defaultValue:
                        'Stores the filter as a predicate — membership refreshes on cadence.',
                    })
                  : t('segments.push.ctaStaticSub', {
                      defaultValue:
                        "Membership won't change after creation. You can convert to Live later.",
                    })}
              </div>
              {allowStatic && (
                <div className={styles.pushAltLink}>
                  {t('segments.push.appendLinkPrefix', { defaultValue: 'or' })}{' '}
                  <a onClick={() => setTab('append')}>
                    {t('segments.push.appendLink', {
                      defaultValue: 'append these users to an existing static segment',
                    })}
                  </a>
                </div>
              )}
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

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <Button type="link" onClick={() => setTab('create')} style={{ paddingLeft: 0 }}>
                {t('segments.push.backToCreate', { defaultValue: '← Back to create' })}
              </Button>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button type="primary" loading={submitting} onClick={handleAppend}>
                  {t('segments.push.submitAppend')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
