/**
 * Sticky bulk-actions toolbar shown when one or more library rows are
 * selected. Exposes Delete, Refresh, Tag (popover), and Export-as-CSV.
 *
 * All operations loop per-segment client-side because the server only exposes
 * per-segment endpoints today. Errors are tallied and surfaced as a single
 * toast at the end of the batch so the user gets one signal, not N.
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button, Popover, Input, Tag as AntTag, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Tags, Download, Trash2, X, Plus } from 'lucide-react';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import styles from '../segments.module.css';

interface Props {
  selected: Segment[];
  onClear: () => void;
  /** Fired after any mutation so the parent can reload. */
  onChanged: () => void;
  /** Tag suggestions from the visible library (existing tags). */
  knownTags: string[];
}

function downloadCsv(rows: Segment[]): void {
  const uids = new Set<string>();
  for (const s of rows) {
    for (const uid of s.uid_list ?? []) uids.add(uid);
  }
  const blob = new Blob(['uid\n' + Array.from(uids).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `segments-${rows.length}-uids.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function runBatch<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
): Promise<{ ok: number; failed: number; lastError: string | null }> {
  let ok = 0;
  let failed = 0;
  let lastError: string | null = null;
  for (const item of items) {
    try {
      await fn(item);
      ok += 1;
    } catch (err) {
      failed += 1;
      lastError = err instanceof SegmentApiError ? err.message : String(err);
    }
  }
  return { ok, failed, lastError };
}

export function BulkActionsToolbar({ selected, onClear, onChanged, knownTags }: Props): ReactElement {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [busy, setBusy] = useState<'delete' | 'refresh' | 'tag' | 'export' | null>(null);
  const count = selected.length;

  const commonTags = useMemo(() => {
    // Tags shared by ALL selected segments (used to show current state).
    if (selected.length === 0) return new Set<string>();
    const first = new Set(selected[0].tags ?? []);
    for (let i = 1; i < selected.length; i++) {
      const next = new Set(selected[i].tags ?? []);
      for (const t of first) if (!next.has(t)) first.delete(t);
    }
    return first;
  }, [selected]);

  async function handleDelete(): Promise<void> {
    setBusy('delete');
    const { ok, failed, lastError } = await runBatch(selected, (s) => segmentsClient.delete(s.id));
    setBusy(null);
    setConfirmDelete(false);
    if (failed === 0) {
      message.success(
        t('segments.actions.bulk.deleteOk', {
          defaultValue: 'Deleted {{count}} segment(s)',
          count: ok,
        }),
      );
    } else {
      message.warning(
        t('segments.actions.bulk.deletePartial', {
          defaultValue: 'Deleted {{ok}}, {{failed}} failed: {{reason}}',
          ok,
          failed,
          reason: lastError ?? '',
        }),
      );
    }
    onChanged();
  }

  async function handleRefresh(): Promise<void> {
    setBusy('refresh');
    const predicates = selected.filter((s) => s.type === 'predicate');
    const skipped = selected.length - predicates.length;
    const { ok, failed, lastError } = await runBatch(predicates, (s) => segmentsClient.refresh(s.id));
    setBusy(null);
    if (failed === 0) {
      message.success(
        t('segments.actions.bulk.refreshOk', {
          defaultValue: 'Refresh queued for {{count}} segment(s){{skipNote}}',
          count: ok,
          skipNote: skipped ? ` (${skipped} static skipped)` : '',
        }),
      );
    } else {
      message.warning(
        t('segments.actions.bulk.refreshPartial', {
          defaultValue: 'Refreshed {{ok}}, {{failed}} failed: {{reason}}',
          ok,
          failed,
          reason: lastError ?? '',
        }),
      );
    }
    onChanged();
  }

  async function handleAddTag(tag: string): Promise<void> {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setBusy('tag');
    const { failed, lastError } = await runBatch(selected, async (s) => {
      const next = Array.from(new Set([...(s.tags ?? []), trimmed]));
      await segmentsClient.update(s.id, { tags: next });
    });
    setBusy(null);
    if (failed === 0) {
      message.success(
        t('segments.actions.bulk.tagAdded', {
          defaultValue: 'Added tag “{{tag}}”',
          tag: trimmed,
        }),
      );
    } else {
      message.warning(lastError ?? 'Some tag updates failed');
    }
    onChanged();
  }

  async function handleRemoveTag(tag: string): Promise<void> {
    setBusy('tag');
    const { failed, lastError } = await runBatch(selected, async (s) => {
      const next = (s.tags ?? []).filter((tt) => tt !== tag);
      await segmentsClient.update(s.id, { tags: next });
    });
    setBusy(null);
    if (failed === 0) {
      message.success(
        t('segments.actions.bulk.tagRemoved', {
          defaultValue: 'Removed tag “{{tag}}”',
          tag,
        }),
      );
    } else {
      message.warning(lastError ?? 'Some tag updates failed');
    }
    onChanged();
  }

  function handleExport(): void {
    setBusy('export');
    downloadCsv(selected);
    setBusy(null);
    message.success(
      t('segments.actions.bulk.exportOk', {
        defaultValue: 'Exported uids from {{count}} segment(s)',
        count: selected.length,
      }),
    );
  }

  return (
    <>
      <div className={styles.bulkToolbar} role="region" aria-label="Bulk actions">
        <div className={styles.bulkToolbarCount}>
          <span>{t('segments.actions.bulk.selected', {
            defaultValue: '{{count}} selected',
            count,
          })}</span>
          <button
            type="button"
            className={styles.bulkClearBtn}
            onClick={onClear}
            aria-label={t('segments.actions.bulk.clear', { defaultValue: 'Clear selection' })}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className={styles.bulkToolbarActions}>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={handleRefresh}
            loading={busy === 'refresh'}
          >
            {t('segments.actions.bulk.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Popover
            trigger="click"
            visible={tagOpen}
            onVisibleChange={setTagOpen}
            placement="bottomRight"
            content={
              <TagPickerContent
                commonTags={Array.from(commonTags)}
                suggestions={knownTags.filter((t) => !commonTags.has(t))}
                onAdd={async (tag) => {
                  await handleAddTag(tag);
                }}
                onRemove={async (tag) => {
                  await handleRemoveTag(tag);
                }}
              />
            }
          >
            <Button icon={<Tags size={14} />} loading={busy === 'tag'}>
              {t('segments.actions.bulk.tag', { defaultValue: 'Tag' })}
            </Button>
          </Popover>
          <Button
            icon={<Download size={14} />}
            onClick={handleExport}
            loading={busy === 'export'}
          >
            {t('segments.actions.bulk.export', { defaultValue: 'Export CSV' })}
          </Button>
          <Button
            danger
            icon={<Trash2 size={14} />}
            onClick={() => setConfirmDelete(true)}
            loading={busy === 'delete'}
          >
            {t('segments.actions.bulk.delete', { defaultValue: 'Delete' })}
          </Button>
        </div>
      </div>

      <ConfirmDestructiveModal
        open={confirmDelete}
        title={t('segments.actions.bulk.confirmDeleteTitle', {
          defaultValue: 'Delete {{count}} segment(s)?',
          count,
        })}
        body={t('segments.actions.bulk.confirmDeleteBody', {
          defaultValue:
            'This permanently removes {{count}} segment(s) and all their tags, activations, refresh log, and pinned analyses. This cannot be undone.',
          count,
        })}
        expectedText={`delete ${count}`}
        okText={t('segments.actions.bulk.confirmDeleteOk', {
          defaultValue: 'Delete {{count}}',
          count,
        })}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

interface PickerProps {
  commonTags: string[];
  suggestions: string[];
  onAdd: (tag: string) => Promise<void>;
  onRemove: (tag: string) => Promise<void>;
}

function TagPickerContent({ commonTags, suggestions, onAdd, onRemove }: PickerProps): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  return (
    <div className={styles.tagPicker}>
      {commonTags.length > 0 && (
        <div className={styles.tagPickerSection}>
          <div className={styles.tagPickerLabel}>
            {t('segments.actions.bulk.currentTags', { defaultValue: 'On all selected' })}
          </div>
          <div className={styles.tagPickerChips}>
            {commonTags.map((tag) => (
              <AntTag key={tag} closable onClose={() => { void onRemove(tag); }}>
                {tag}
              </AntTag>
            ))}
          </div>
        </div>
      )}
      <div className={styles.tagPickerSection}>
        <div className={styles.tagPickerLabel}>
          {t('segments.actions.bulk.addTag', { defaultValue: 'Add tag' })}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Input
            size="small"
            value={draft}
            placeholder="liveops"
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={() => {
              if (draft.trim()) { void onAdd(draft); setDraft(''); }
            }}
          />
          <Button
            size="small"
            type="primary"
            icon={<Plus size={12} />}
            disabled={!draft.trim()}
            onClick={() => { void onAdd(draft); setDraft(''); }}
          />
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className={styles.tagPickerSection}>
          <div className={styles.tagPickerLabel}>
            {t('segments.actions.bulk.suggestedTags', { defaultValue: 'Suggested' })}
          </div>
          <div className={styles.tagPickerChips}>
            {suggestions.slice(0, 10).map((tag) => (
              <button
                type="button"
                key={tag}
                className={styles.tagSuggestionBtn}
                onClick={() => { void onAdd(tag); }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
