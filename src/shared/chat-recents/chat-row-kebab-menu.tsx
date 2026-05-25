/**
 * Kebab menu for chat conversation rows (Huashua-style).
 *
 * Layout mirrors src/pages/Segments/library/row-actions-menu.tsx so the panel
 * has a single owning border-radius. Active actions: Delete only. The Star /
 * Rename / Change project / Remove from project rows are visual placeholders
 * (disabled, tooltipped) until those features land — keeping the menu visually
 * complete avoids re-layout when they are wired in.
 *
 * Delete fires `notifyChatSessionChanged(id)` so every `useChatSessionsList`
 * subscriber refetches; if the active route is /chat/:id of the deleted
 * session, the caller redirects to /chat via onDeleted.
 */

import { MouseEvent, ReactElement } from 'react';
import { Dropdown, Modal, Tooltip, message } from 'antd';
import { MoreVertical, Star, Pencil, FolderInput, FolderMinus, Trash2 } from 'lucide-react';
import styled from 'styled-components';

import { deleteChatSession } from '../../api/chat-sessions-client';
import { notifyChatSessionChanged } from '../../shell/chat-overlay/chat-session-events';

interface Props {
  sessionId: string;
  sessionTitle?: string;
  /** Called after a successful delete (e.g. redirect away from a deleted thread). */
  onDeleted?: (id: string) => void;
  /** Icon button size. Defaults to 16. */
  iconSize?: number;
  /**
   * z-index for the dropdown panel and confirm modal. Needed when the menu
   * is rendered inside a high-z-index host (e.g. the chat search overlay at
   * z-index 9999), otherwise antd's defaults (~1050 / ~1000) put the panel
   * and the delete confirmation behind the host's backdrop and clicks land
   * on the backdrop instead of the menu.
   */
  menuZIndex?: number;
}

const DEFAULT_MENU_Z = 1050;

const Shell = styled.div`
  min-width: 220px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-card, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  padding: 6px 0;
  font-family: var(--font-sans);
`;

const Row = styled.button<{ $danger?: boolean; $disabled?: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  font-size: 14px;
  color: ${(p) =>
    p.$disabled
      ? 'var(--text-disabled, rgba(0, 0, 0, 0.32))'
      : p.$danger
      ? 'var(--danger, #e5484d)'
      : 'var(--text-primary)'};
  transition: background 100ms ease;

  &:hover,
  &:focus-visible {
    outline: none;
    background: ${(p) =>
      p.$disabled
        ? 'transparent'
        : p.$danger
        ? 'var(--danger-soft, #fff1f0)'
        : 'var(--bg-muted, rgba(0, 0, 0, 0.04))'};
  }
`;

const Divider = styled.div`
  height: 1px;
  margin: 4px 0;
  background: var(--border-card, rgba(0, 0, 0, 0.08));
`;

const KebabButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary, rgba(0, 0, 0, 0.55));
  cursor: pointer;
  transition: background 100ms ease;

  &:hover,
  &:focus-visible {
    outline: none;
    background: var(--bg-muted, rgba(0, 0, 0, 0.06));
    color: var(--text-primary);
  }
`;

const COMING_SOON = 'Coming soon';

export function ChatRowKebabMenu({
  sessionId,
  sessionTitle,
  onDeleted,
  iconSize = 16,
  menuZIndex = DEFAULT_MENU_Z,
}: Props): ReactElement {
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function performDelete() {
    try {
      await deleteChatSession(sessionId);
      notifyChatSessionChanged(sessionId);
      const name = sessionTitle?.trim() || 'Conversation';
      message.success(`Deleted "${name}"`);
      onDeleted?.(sessionId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }

  function handleDeleteClick(e: MouseEvent) {
    stop(e);
    Modal.confirm({
      title: 'Delete conversation?',
      content: sessionTitle?.trim()
        ? `"${sessionTitle.trim()}" will be permanently removed. This cannot be undone.`
        : 'This conversation will be permanently removed. This cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: performDelete,
      zIndex: menuZIndex + 1,
    });
  }

  // The overlay is portaled to <body> but its events still bubble through
  // the React tree to the parent row (which calls openSession). Catch every
  // click here so disabled rows and inert tooltips don't navigate the user
  // away when they intended to interact with the menu.
  const overlay = (
    <Shell role="menu" aria-label="Conversation actions" onClick={stop}>
      <Tooltip title={COMING_SOON} placement="left">
        <Row type="button" role="menuitem" $disabled aria-disabled onClick={stop}>
          <Star size={15} aria-hidden />
          Star
        </Row>
      </Tooltip>
      <Tooltip title={COMING_SOON} placement="left">
        <Row type="button" role="menuitem" $disabled aria-disabled onClick={stop}>
          <Pencil size={15} aria-hidden />
          Rename
        </Row>
      </Tooltip>
      <Tooltip title={COMING_SOON} placement="left">
        <Row type="button" role="menuitem" $disabled aria-disabled onClick={stop}>
          <FolderInput size={15} aria-hidden />
          Change project
        </Row>
      </Tooltip>
      <Tooltip title={COMING_SOON} placement="left">
        <Row type="button" role="menuitem" $disabled aria-disabled onClick={stop}>
          <FolderMinus size={15} aria-hidden />
          Remove from project
        </Row>
      </Tooltip>
      <Divider aria-hidden />
      <Row type="button" role="menuitem" $danger onClick={handleDeleteClick}>
        <Trash2 size={15} aria-hidden />
        Delete
      </Row>
    </Shell>
  );

  return (
    <Dropdown
      overlay={overlay}
      trigger={['click']}
      placement="bottomRight"
      overlayStyle={{ zIndex: menuZIndex }}
    >
      <KebabButton
        type="button"
        aria-label="Conversation actions"
        onClick={stop}
      >
        <MoreVertical size={iconSize} aria-hidden />
      </KebabButton>
    </Dropdown>
  );
}
