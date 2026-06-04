/**
 * BottomRow — sidebar footer with Data · Glossary links + Theme toggle. Data and
 * Glossary sit together as the data-modeling entry points just above the utility
 * actions. Data is access-gated by the `data-model` feature; the API-credentials
 * trigger now lives on the Settings → API tab (off the rail).
 * Replaces Hermes' Data/Settings/Account rows with cube-specific actions.
 */
import React from 'react';
import { BookOpen, Sun, Moon, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarItem } from './sidebar-item';
import { useTheme } from '../../theme/use-theme';
import { useHasFeature } from '../../auth/feature-access';

interface BottomRowProps {
  collapsed?: boolean;
}

export function BottomRow({ collapsed }: BottomRowProps) {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const hasFeature = useHasFeature();

  const isDark = theme === 'dark';

  return (
    <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '6px 0 8px' }}>
      {hasFeature('data-model') && (
        <SidebarItem
          icon={Database}
          label={t('nav.dataHub')}
          to="/data"
          collapsed={collapsed}
        />
      )}
      <SidebarItem
        icon={BookOpen}
        label={t('nav.glossary')}
        to="/catalog/glossary"
        collapsed={collapsed}
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
