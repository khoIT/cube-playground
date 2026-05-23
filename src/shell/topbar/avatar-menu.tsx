/**
 * AvatarMenu — topbar user menu. Wraps cube's existing UserMenu component,
 * which already renders a 32×32 brand circle with initials + Antd dropdown
 * containing theme/lang toggles, settings, security context, sign out.
 */
import React from 'react';
import { UserMenu } from '../../components/Header/user-menu';

export function AvatarMenu() {
  return <UserMenu />;
}
