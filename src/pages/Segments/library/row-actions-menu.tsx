/**
 * Kebab menu shown at the end of each library row.
 *
 * Actions: Duplicate, Delete. Built as an antd Dropdown wrapping a styled
 * Shell + Row primitives — mirrors the game-picker / user-menu pattern so the
 * panel has a single owning border-radius (no lop-sided bleed at corners that
 * antd's <Menu> produces inside Dropdown).
 *
 * Click handlers stop propagation + preventDefault so the wrapping <Link> on
 * the row does not navigate when the user opens the menu or picks an action.
 */

import { ReactElement, useState, MouseEvent } from 'react';
import { Dropdown, message, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Trash2, Copy, ArrowUpRight, Radio, Ban } from 'lucide-react';
import styled from 'styled-components';
import { segmentsClient } from '../../../api/segments-client';
import { promoteSegmentToConcept } from '../../../api/concepts-client';
import { SegmentApiError } from '../../../api/api-client';
import type { Segment } from '../../../types/segment-api';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import { removeRecent } from '../../../shell/sidebar/recent-items-store';
import { invalidateSegmentIds } from '../use-segment-ids';
import styles from '../segments.module.css';

interface Props {
  segment: Segment;
  /** Called after a successful mutation so the parent can reload its list. */
  onChanged: (id: string) => void;
}

const Shell = styled.div`
  min-width: 200px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-md);
  padding: 4px 0;
  overflow: hidden;
  font-family: var(--font-sans);
`;

const Row = styled.button<{ $danger?: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: ${(p) => (p.$danger ? 'var(--danger)' : 'var(--text-primary)')};
  transition: background 100ms ease;

  &:hover,
  &:focus-visible {
    outline: none;
    background: ${(p) => (p.$danger ? 'var(--destructive-soft)' : 'var(--bg-muted)')};
  }
`;

const Divider = styled.div`
  height: 1px;
  margin: 4px 0;
  background: var(--border-card);
`;

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
      removeRecent('segments', segment.id);
      invalidateSegmentIds();
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
      invalidateSegmentIds();
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

  async function handlePromote() {
    try {
      await promoteSegmentToConcept(segment.id, 'term');
      message.success(
        t('segments.actions.promote.success', {
          defaultValue: 'Proposed “{{name}}” as a draft glossary term',
          name: segment.name,
        }),
      );
    } catch (err) {
      // 403 → caller lacks the editor role; surface the server message verbatim.
      const reason = err instanceof SegmentApiError ? err.message : 'Failed to promote segment';
      message.error(reason);
    }
  }

  async function handlePublish() {
    try {
      await segmentsClient.serve(segment.id);
      message.success(
        t('segments.actions.publish.success', {
          defaultValue: 'Published “{{name}}” for downstream serving',
          name: segment.name,
        }),
      );
      onChanged(segment.id);
    } catch (err) {
      // 409 SNAPSHOT_DISABLED / VALIDATION → surface the server message verbatim.
      const reason = err instanceof SegmentApiError ? err.message : 'Failed to publish segment';
      message.error(reason);
    }
  }

  async function handleDemote(force = false) {
    try {
      await segmentsClient.demote(segment.id, force);
      message.success(
        t('segments.actions.demote.success', {
          defaultValue: 'Demoted “{{name}}” — no longer served downstream',
          name: segment.name,
        }),
      );
      onChanged(segment.id);
    } catch (err) {
      // Blocked because consumers are entitled — offer an explicit force-deprecate.
      if (err instanceof SegmentApiError && err.status === 409 && err.code === 'HAS_CONSUMERS') {
        const n = segment.serving?.entitledCount ?? 0;
        Modal.confirm({
          title: t('segments.actions.demote.forceTitle', { defaultValue: 'Force-demote a served segment?' }),
          content: t('segments.actions.demote.forceBody', {
            defaultValue:
              '{{count}} key(s) are entitled to pull this segment. Demoting will immediately block their pulls (403). It will be marked “Retired”.',
            count: n,
          }),
          okText: t('segments.actions.demote.forceOk', { defaultValue: 'Force demote' }),
          okButtonProps: { danger: true },
          onOk: () => handleDemote(true),
        });
        return;
      }
      const reason = err instanceof SegmentApiError ? err.message : 'Failed to demote segment';
      message.error(reason);
    }
  }

  const overlay = (
    <Shell role="menu" aria-label={t('segments.actions.more', { defaultValue: 'More actions' })}>
      {segment.can_administer && segment.lifecycle !== 'served' && (
        <Row
          type="button"
          role="menuitem"
          onClick={(e) => {
            stop(e);
            void handlePublish();
          }}
        >
          <Radio size={14} aria-hidden />
          {t('segments.actions.publish.menuItem', { defaultValue: 'Publish for downstream' })}
        </Row>
      )}
      {segment.can_administer && segment.lifecycle === 'served' && (
        <Row
          type="button"
          role="menuitem"
          onClick={(e) => {
            stop(e);
            void handleDemote(false);
          }}
        >
          <Ban size={14} aria-hidden />
          {t('segments.actions.demote.menuItem', { defaultValue: 'Demote (unpublish)' })}
        </Row>
      )}
      <Row
        type="button"
        role="menuitem"
        onClick={(e) => {
          stop(e);
          void handleDuplicate();
        }}
      >
        <Copy size={14} aria-hidden />
        {t('segments.actions.duplicate.menuItem', { defaultValue: 'Duplicate segment' })}
      </Row>
      <Row
        type="button"
        role="menuitem"
        onClick={(e) => {
          stop(e);
          void handlePromote();
        }}
      >
        <ArrowUpRight size={14} aria-hidden />
        {t('segments.actions.promote.menuItem', { defaultValue: 'Promote to glossary term' })}
      </Row>
      <Divider aria-hidden />
      <Row
        type="button"
        role="menuitem"
        $danger
        onClick={(e) => {
          stop(e);
          setConfirmOpen(true);
        }}
      >
        <Trash2 size={14} aria-hidden />
        {t('segments.actions.delete.menuItem', { defaultValue: 'Delete segment' })}
      </Row>
    </Shell>
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
