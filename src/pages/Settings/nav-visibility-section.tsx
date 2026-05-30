/**
 * Settings tab: sidebar nav visibility. Renders a checkbox row per sidebar
 * section so the user can hide entries from the left rail. Hidden sections
 * still resolve via direct URL — this only trims the rail.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import {
  Check,
  MessageSquare,
  LayoutDashboard,
  LayoutGrid,
  Radio,
  Grid,
  BookOpen,
  Users,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
  ResetButton,
} from './section-card';
import {
  NAV_ITEMS,
  useVisibleNavItems,
  type NavItemId,
} from './use-visible-nav-items';

const ItemList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ItemRow = styled.li<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.55 : 1)};
  transition: background-color 120ms ease;

  &:hover {
    background: ${(p) => (p.$disabled ? 'transparent' : 'var(--bg-muted)')};
  }
`;

const RowCheckbox = styled.span<{ $checked: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid ${(p) => (p.$checked ? 'var(--brand)' : 'var(--border-strong)')};
  background: ${(p) => (p.$checked ? 'var(--brand)' : 'transparent')};
  color: var(--text-on-brand);
  transition: background-color 120ms ease, border-color 120ms ease;
`;

const RowIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-secondary);
`;

const RowLabel = styled.span`
  flex: 1;
  font-size: 13.5px;
  font-weight: 500;
`;

const ICONS: Record<NavItemId, LucideIcon> = {
  chats: MessageSquare,
  playground: LayoutDashboard,
  'data-model': Grid,
  'metrics-catalog': BookOpen,
  liveops: Radio,
  dashboards: LayoutGrid,
  'drift-center': AlertTriangle,
  segments: Users,
};

export function NavVisibilitySection(): ReactElement {
  const { t } = useTranslation();
  const { isVisible, toggle, showAll, hidden } = useVisibleNavItems();

  const title = t('settings.navVisibility.title', {
    defaultValue: 'Sidebar visibility',
  });

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>{title}</SectionTitle>
          <SectionHint>
            {t('settings.navVisibility.hint', {
              defaultValue:
                'Choose which sections appear in the left sidebar. Hidden sections stay reachable via direct URL — this only trims the rail.',
            })}
          </SectionHint>
        </div>
        <ResetButton type="button" onClick={showAll} disabled={hidden.size === 0}>
          {t('settings.navVisibility.showAll', { defaultValue: 'Show all' })}
        </ResetButton>
      </SectionHead>

      <ItemList role="group" aria-label={title}>
        {NAV_ITEMS.map((item) => {
          const checked = isVisible(item.id);
          // Block the last toggle: if everything else is hidden, this row is
          // the only remaining visible entry — disable it to prevent blanking
          // the rail entirely. Matches the guard in useVisibleNavItems.toggle.
          const wouldBeLast = checked && hidden.size === NAV_ITEMS.length - 1;
          const Icon = ICONS[item.id];
          return (
            <ItemRow
              key={item.id}
              role="checkbox"
              aria-checked={checked}
              aria-disabled={wouldBeLast || undefined}
              tabIndex={wouldBeLast ? -1 : 0}
              $disabled={wouldBeLast}
              onClick={() => !wouldBeLast && toggle(item.id)}
              onKeyDown={(e) => {
                if (wouldBeLast) return;
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  toggle(item.id);
                }
              }}
            >
              <RowCheckbox $checked={checked} aria-hidden>
                {checked ? <Check size={12} strokeWidth={3} /> : null}
              </RowCheckbox>
              <RowIcon aria-hidden>
                <Icon size={16} strokeWidth={1.75} />
              </RowIcon>
              <RowLabel>{t(item.labelKey)}</RowLabel>
            </ItemRow>
          );
        })}
      </ItemList>
    </SectionCard>
  );
}

export default NavVisibilitySection;
