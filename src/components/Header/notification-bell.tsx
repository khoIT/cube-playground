import { Popover } from 'antd';
import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import {
  listChatNotifications,
  markChatNotificationRead,
  type ChatNotification,
} from '../../api/chat-notifications-client';

const POLL_INTERVAL_MS = 30_000;

const Trigger = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;

  &:hover,
  &:focus {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
`;

const UnreadDot = styled.span`
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 8px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--danger);
  box-shadow: 0 0 0 2px var(--bg-card);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
`;

const PopoverBody = styled.div`
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-primary);
`;

const EmptyState = styled.div`
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12.5px;
`;

const Row = styled.button<{ $unread: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
  text-align: left;
  width: 100%;
  padding: 10px 12px;
  background: ${(p) => (p.$unread ? 'var(--bg-muted)' : 'transparent')};
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;

  &:hover {
    background: var(--bg-muted);
  }

  &:last-child {
    border-bottom: none;
  }
`;

const RowKind = styled.span`
  font-weight: 600;
  font-size: 12.5px;
  color: var(--text-primary);
  text-transform: capitalize;
`;

const RowSummary = styled.span`
  font-size: 12.5px;
  color: var(--text-secondary);
  word-break: break-word;
`;

const RowMeta = styled.span`
  font-size: 11px;
  color: var(--text-muted);
`;

function summarisePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.summary === 'string') return obj.summary;
  if (typeof obj.target_id === 'string') return obj.target_id;
  return '';
}

export function NotificationBell() {
  const { t } = useTranslation();
  const title = t('notifications.title');
  const [items, setItems] = useState<ChatNotification[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const controller = new AbortController();
      const result = await listChatNotifications({ limit: 20, signal: controller.signal });
      if (!cancelled) {
        setItems(result.items);
        setUnread(result.unread);
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function handleClick(notification: ChatNotification) {
    if (notification.readAt != null) return;
    const ok = await markChatNotificationRead(notification.id);
    if (!ok) return;
    setItems((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnread((n) => Math.max(0, n - 1));
  }

  const content =
    items.length === 0 ? (
      <EmptyState>{t('notifications.empty')}</EmptyState>
    ) : (
      <PopoverBody>
        {items.map((n) => (
          <Row
            key={n.id}
            type="button"
            $unread={n.readAt == null}
            onClick={() => handleClick(n)}
          >
            <RowKind>{n.kind.replace(/_/g, ' ')}</RowKind>
            {summarisePayload(n.payload) ? (
              <RowSummary>{summarisePayload(n.payload)}</RowSummary>
            ) : null}
            <RowMeta>{new Date(n.createdAt).toLocaleString()}</RowMeta>
          </Row>
        ))}
      </PopoverBody>
    );

  return (
    <Popover trigger="click" placement="bottomRight" title={title} content={content}>
      <Trigger type="button" aria-label={title}>
        <Bell size={16} strokeWidth={2} />
        {unread > 0 ? <UnreadDot aria-hidden>{unread > 9 ? '9+' : unread}</UnreadDot> : null}
      </Trigger>
    </Popover>
  );
}
