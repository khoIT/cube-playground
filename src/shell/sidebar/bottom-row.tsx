/**
 * BottomRow — sidebar footer with Data · Glossary links + API Settings trigger
 * + Theme toggle. Data and Glossary sit together as the data-modeling entry
 * points just above the utility actions.
 * Replaces Hermes' Data/Settings/Account rows with cube-specific actions.
 */
import React from 'react';
import { BookOpen, Settings2, Sun, Moon, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarItem } from './sidebar-item';
import { useTheme } from '../../theme/use-theme';
import { useSecurityContext } from '../../hooks/security-context';

interface BottomRowProps {
  collapsed?: boolean;
}

export function BottomRow({ collapsed }: BottomRowProps) {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const security = useSecurityContext();

  const isDark = theme === 'dark';

  return (
    <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '6px 0 8px' }}>
      <SidebarItem
        icon={Database}
        label={t('nav.dataHub')}
        to="/data"
        collapsed={collapsed}
      />
      <SidebarItem
        icon={BookOpen}
        label={t('nav.glossary')}
        to="/catalog/glossary"
        collapsed={collapsed}
      />
      <SidebarItem
        icon={Settings2}
        label="API Settings"
        collapsed={collapsed}
        onClick={() => security.setIsModalOpen(true)}
      />
      <SidebarItem
        icon={isDark ? Sun : Moon}
        label={isDark ? 'Light mode' : 'Dark mode'}
        collapsed={collapsed}
        onClick={toggle}
      />
    </div>
  );
}
