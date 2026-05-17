import { Popover } from 'antd';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

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
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 2px var(--bg-card);
`;

const PopoverBody = styled.div`
  width: 240px;
  padding: 8px 4px;
  text-align: center;
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--text-muted);
`;

const HARDCODED_UNREAD = true;

export function NotificationBell() {
  const { t } = useTranslation();
  const title = t('notifications.title');

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title={title}
      content={<PopoverBody>{t('notifications.empty')}</PopoverBody>}
    >
      <Trigger type="button" aria-label={title}>
        <Bell size={16} strokeWidth={2} />
        {HARDCODED_UNREAD ? <UnreadDot aria-hidden /> : null}
      </Trigger>
    </Popover>
  );
}
