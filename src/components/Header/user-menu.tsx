import { Dropdown } from 'antd';
import { Lock, LogOut, Settings as SettingsIcon, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory, useLocation } from 'react-router-dom';
import styled from 'styled-components';

import { useCloud } from '../../cloud';
import { useAppContext, useSecurityContext } from '../../hooks';
import { useAuth, useAuthUser } from '../../auth/auth-context';
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
  background: var(--success);
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

const IdentityHead = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 8px 12px 10px;
`;

const IdentityEyebrow = styled.span`
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
`;

const IdentityEmail = styled.span`
  max-width: 100%;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const IdentityRole = styled.span`
  margin-top: 2px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
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

function deriveInitials(identity: string | undefined | null): string {
  if (!identity) return 'JN';
  // For an email, initials come from the local part (before @), never the
  // domain — "khoitn@vng.com.vn" → "KH", not "VN".
  const base = identity.includes('@') ? identity.split('@')[0] : identity;
  // Split on the usual identity separators (dot / underscore / hyphen / space):
  // "khoi.tran" → "KT", "gds-cube" → "GC", "khoitn" → "KH".
  const parts = base.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length === 0) return 'JN';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserMenu() {
  const { t } = useTranslation();
  const location = useLocation();
  const history = useHistory();
  const { identifier } = useAppContext();
  const authUser = useAuthUser();
  const { logout } = useAuth();
  const { token: securityContextToken, setIsModalOpen } = useSecurityContext();
  const { isAddRollupButtonVisible } = useCloud();
  const [signingOut, setSigningOut] = useState(false);

  // Prefer the authenticated identity over the playground context `identifier`,
  // which in prod is the generic workspace id ('gds-cube' → "GC") and tells the
  // user nothing about who they're signed in as.
  const email = authUser?.email ?? null;
  const initials = deriveInitials(email || authUser?.username || identifier);
  const role = authUser?.role ?? null;
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

  function openSettings() {
    history.push('/settings');
  }

  function handleSignOut() {
    // logout() redirects to the realm end-session endpoint for SSO sessions
    // (unmounting this menu), so guard against a double-click firing it twice.
    if (signingOut) return;
    setSigningOut(true);
    void logout().catch(() => setSigningOut(false));
  }

  const overlay = (
    <MenuShell role="menu">
      {email ? (
        <>
          <IdentityHead data-testid="user-menu-identity">
            <IdentityEyebrow>
              {t('user.signedInAs', { defaultValue: 'Signed in as' })}
            </IdentityEyebrow>
            <IdentityEmail title={email}>{email}</IdentityEmail>
            {role ? <IdentityRole>{role}</IdentityRole> : null}
          </IdentityHead>
          <Divider />
        </>
      ) : null}
      <ThemeToggle />
      <LanguageToggle />
      <Divider />
      <MenuItem
        type="button"
        role="menuitem"
        data-testid="user-menu-settings"
        onClick={openSettings}
      >
        <SettingsIcon size={14} strokeWidth={2} aria-hidden />
        {t('user.settings.settings', { defaultValue: 'Settings' })}
      </MenuItem>
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
      <MenuItem
        type="button"
        role="menuitem"
        data-testid="user-menu-sign-out"
        onClick={handleSignOut}
        disabled={signingOut}
      >
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
