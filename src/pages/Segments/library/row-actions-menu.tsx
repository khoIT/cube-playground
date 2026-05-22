/**
 * Kebab menu shown at the end of each library row.
 *
 * Actions: Duplicate, Delete. Built as a Dropdown so future actions can be
 * added without widening the table.
 *
 * Click handlers stop propagation + preventDefault so the wrapping <Link> on
 * the row does not navigate when the user opens the menu or picks an action.
 */

import { ReactElement, useState, MouseEvent } from 'react';
import { Dropdown, Menu, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Trash2, Copy } from 'lucide-react';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import styles from '../segments.module.css';

interface Props {
  segment: Segment;
  /** Called after a successful mutation so the parent can reload its list. */
  onChanged: (id: string) => void;
}

export function RowActionsMenu({ segment, onChanged }: Props): ReactElement {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function handleDelete() {
    try {
      await segmentsClient.delete(segment.id);
      message.success(
        t('segments.actions.delete.success', {
          defaultValue: 'Deleted “{{name}}”',
          name: segment.name,
        }),
      );
      setConfirmOpen(false);
      onChanged(segment.id);
    } catch (err) {
      const reason = err instanceof SegmentApiError ? err.message : 'Failed to delete segment';
      message.error(reason);
    }
  }

  async function handleDuplicate() {
    try {
      const created = await segmentsClient.create({
        name: t('segments.actions.duplicate.copyName', {
          defaultValue: '{{name}} (copy)',
          name: segment.name,
        }),
        type: segment.type,
        cube: segment.cube,
        tags: segment.tags,
        predicate_tree: segment.predicate_tree,
        refresh_cadence_min: segment.refresh_cadence_min,
        game_id: segment.game_id,
        uid_list: [],
      });
      if (created.type === 'predicate') {
        try { await segmentsClient.refresh(created.id); } catch { /* best-effort */ }
      }
      message.success(
        t('segments.actions.duplicate.success', {
          defaultValue: 'Duplicated as “{{name}}”',
          name: created.name,
        }),
      );
      onChanged(created.id);
    } catch (err) {
      const reason = err instanceof SegmentApiError ? err.message : 'Failed to duplicate segment';
      message.error(reason);
    }
  }

  const overlay = (
    <Menu>
      <Menu.Item
        key="duplicate"
        icon={<Copy size={14} aria-hidden />}
        onClick={({ domEvent }) => {
          stop(domEvent as unknown as MouseEvent);
          void handleDuplicate();
        }}
      >
        {t('segments.actions.duplicate.menuItem', { defaultValue: 'Duplicate segment' })}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        key="delete"
        danger
        icon={<Trash2 size={14} aria-hidden />}
        onClick={({ domEvent }) => {
          stop(domEvent as unknown as MouseEvent);
          setConfirmOpen(true);
        }}
      >
        {t('segments.actions.delete.menuItem', { defaultValue: 'Delete segment' })}
      </Menu.Item>
    </Menu>
  );

  return (
    <>
      <Dropdown overlay={overlay} trigger={['click']} placement="bottomRight">
        <button
          type="button"
          className={styles.rowKebabBtn}
          aria-label={t('segments.actions.more', { defaultValue: 'More actions' })}
          onClick={stop}
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      </Dropdown>

      <ConfirmDestructiveModal
        open={confirmOpen}
        title={t('segments.actions.delete.title', { defaultValue: 'Delete segment?' })}
        body={t('segments.actions.delete.body', {
          defaultValue:
            'This permanently removes “{{name}}” along with its tags, activations, refresh log, and pinned analyses. This cannot be undone.',
          name: segment.name,
        })}
        expectedText={segment.name}
        okText={t('segments.actions.delete.ok', { defaultValue: 'Delete segment' })}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
