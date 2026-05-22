/**
 * Kebab menu shown at the end of each library row.
 *
 * For now exposes a single destructive "Delete segment" action — built as a
 * Dropdown so future actions (duplicate, rename, archive) can be added without
 * widening the table.
 *
 * Click handlers stop propagation + preventDefault so the wrapping <Link> on
 * the row does not navigate when the user opens the menu or picks an action.
 */

import { ReactElement, useState, MouseEvent } from 'react';
import { Dropdown, Menu, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import styles from '../segments.module.css';

interface Props {
  segment: Segment;
  /** Called after a successful delete so the parent can refresh its list. */
  onDeleted: (id: string) => void;
}

export function RowActionsMenu({ segment, onDeleted }: Props): ReactElement {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function handleConfirm() {
    try {
      await segmentsClient.delete(segment.id);
      message.success(
        t('segments.actions.delete.success', {
          defaultValue: 'Deleted “{{name}}”',
          name: segment.name,
        }),
      );
      setConfirmOpen(false);
      onDeleted(segment.id);
    } catch (err) {
      const reason = err instanceof SegmentApiError ? err.message : 'Failed to delete segment';
      message.error(reason);
    }
  }

  const overlay = (
    <Menu>
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
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
