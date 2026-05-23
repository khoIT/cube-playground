/**
 * SidebarDataModelSection — Data Model entry with "+ New data model" CTA
 * and a "Recently viewed" sub-list driven by recent-items-store.
 */
import React, { useEffect, useState } from 'react';
import { Grid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarSection } from './sidebar-section';
import { SidebarItem } from './sidebar-item';
import { SidebarSubheader } from './sidebar-subheader';
import { getRecent } from './recent-items-store';

interface Props {
  collapsed?: boolean;
}

export function SidebarDataModelSection({ collapsed }: Props) {
  const { t } = useTranslation();
  const [recent, setRecent] = useState(() => getRecent('data-model'));

  useEffect(() => {
    const handler = () => setRecent(getRecent('data-model'));
    window.addEventListener('gds-cube:recent-changed', handler);
    return () => window.removeEventListener('gds-cube:recent-changed', handler);
  }, []);

  return (
    <SidebarSection
      id="data-model"
      icon={Grid}
      label={t('nav.dataModel')}
      to="/catalog/data-model"
      collapsed={collapsed}
    >
      <SidebarItem
        label={t('nav.dataModelNew')}
        to="/data-model/new?v=2"
        indent
        primary
      />
      {recent.length > 0 && (
        <>
          <SidebarSubheader>Recently viewed</SidebarSubheader>
          {recent.slice(0, 5).map(it => (
            <SidebarItem
              key={it.id}
              label={it.title}
              to={it.href ?? `/catalog/data-model/${it.id}`}
              indent
            />
          ))}
        </>
      )}
    </SidebarSection>
  );
}
