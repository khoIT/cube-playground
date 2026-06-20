/**
 * EditableSegmentTitle — the segment detail <h1>, with click-to-edit rename for
 * owners/admins. Renames persist via segmentsClient.update(id, { name }); the
 * saved Segment is handed back so the parent updates breadcrumb + recent tray.
 *
 * Non-administrators (or while saving) see a plain, non-interactive title.
 */
import { ReactElement, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import { segmentsClient } from '../../../../api/segments-client';
import { SegmentApiError } from '../../../../api/api-client';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  onRename: (updated: Segment) => void;
}

export function EditableSegmentTitle({ segment, onRename }: Props): ReactElement {
  const { t } = useTranslation();
  const canEdit = segment.can_administer;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(segment.name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync if the segment changes underneath us (live polling /
  // another rename) while not actively editing.
  useEffect(() => {
    if (!editing) setDraft(segment.name);
  }, [segment.name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const cancel = (): void => {
    setDraft(segment.name);
    setEditing(false);
  };

  const commit = async (): Promise<void> => {
    const next = draft.trim();
    if (!next || next === segment.name) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      const updated = await segmentsClient.update(segment.id, { name: next });
      onRename(updated);
      setEditing(false);
      message.success(
        t('segments.detail.rename.success', { defaultValue: 'Renamed to “{{name}}”', name: next }),
      );
    } catch (err) {
      const reason =
        err instanceof SegmentApiError ? err.message : 'Failed to rename segment';
      message.error(reason);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${styles.detailTitle} ${styles.detailTitleInput}`}
        value={draft}
        disabled={saving}
        aria-label={t('segments.detail.rename.label', { defaultValue: 'Segment name' })}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
      />
    );
  }

  if (!canEdit) {
    return <h1 className={styles.detailTitle}>{segment.name}</h1>;
  }

  return (
    <button
      type="button"
      className={styles.detailTitleEditable}
      onClick={() => setEditing(true)}
      title={t('segments.detail.rename.hint', { defaultValue: 'Click to rename' })}
    >
      <h1 className={styles.detailTitle}>{segment.name}</h1>
      <Pencil className={styles.detailTitleEditIcon} size={15} aria-hidden />
    </button>
  );
}
