import { Dropdown } from 'antd';
import { Lock, LogOut, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';

import { useCloud } from '../../cloud';
import { useAppContext, useSecurityContext } from '../../hooks';
import { OPEN_ROLLUP_DESIGNER_EVENT } from '../../rollup-designer';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

const Trigger = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--brand);
  border: none;
  border-radius: 50%;
  color: var(--text-on-brand);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background-color 120ms ease;

  &:hover,
  &:focus {
    background: var(--brand-hover);
  }
`;

const ActiveDot = styled.span`
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 2px var(--bg-card);
`;

const MenuShell = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sm);
  padding: 6px 0;
  min-width: 240px;
`;

const Divider = styled.div`
  height: 1px;
  margin: 6px 0;
  background: var(--border-card);
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;

  &:hover,
  &:focus {
    background: var(--bg-muted);
  }
`;

function deriveInitials(identifier: string | undefined | null): string {
  if (!identifier) return 'JN';
  const cleaned = identifier.replace(/[^a-zA-Z\s]/g, ' ').trim();
  if (!cleaned) return 'JN';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserMenu() {
  const { t } = useTranslation();
  const location = useLocation();
  const { identifier } = useAppContext();
  const { token: securityContextToken, setIsModalOpen } = useSecurityContext();
  const { isAddRollupButtonVisible } = useCloud();

  const initials = deriveInitials(identifier);
  const onBuildRoute = location.pathname.startsWith('/build');
  const rollupVisible =
    onBuildRoute &&
    (isAddRollupButtonVisible == null || isAddRollupButtonVisible);

  function openSecurityContext() {
    setIsModalOpen(true);
  }

  function openAddRollup() {
    window.dispatchEvent(new Event(OPEN_ROLLUP_DESIGNER_EVENT));
  }

  const overlay = (
    <MenuShell role="menu">
      <ThemeToggle />
      <LanguageToggle />
      <Divider />
      <MenuItem
        type="button"
        role="menuitem"
        data-testid="user-menu-security-context"
        onClick={openSecurityContext}
      >
        <Lock size={14} strokeWidth={2} aria-hidden />
        {t('user.settings.securityContext')}
      </MenuItem>
      {rollupVisible ? (
        <MenuItem
          type="button"
          role="menuitem"
          data-testid="user-menu-add-rollup"
          onClick={openAddRollup}
        >
          <Zap size={14} strokeWidth={2} aria-hidden />
          {t('user.settings.addRollup')}
        </MenuItem>
      ) : null}
      <Divider />
      <MenuItem type="button" role="menuitem" data-testid="user-menu-sign-out">
        <LogOut size={14} strokeWidth={2} aria-hidden />
        {t('user.signOut')}
      </MenuItem>
    </MenuShell>
  );

  return (
    <Dropdown
      overlay={overlay}
      trigger={['click']}
      placement="bottomRight"
      overlayStyle={{ paddingTop: 4 }}
    >
      <Trigger type="button" aria-label={t('user.menuLabel')}>
        {initials}
        {securityContextToken ? <ActiveDot aria-hidden /> : null}
      </Trigger>
    </Dropdown>
  );
}
