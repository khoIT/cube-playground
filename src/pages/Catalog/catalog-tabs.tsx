import { useTranslation } from 'react-i18next';
import { useHistory, useLocation } from 'react-router-dom';
import styled, { css } from 'styled-components';

const Strip = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-app);
`;

const TabButton = styled.button<{ $active: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 38px;
  padding: 0 14px;
  background: transparent;
  border: none;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 120ms ease;

  &:hover {
    color: var(--text-primary);
  }

  ${(p) =>
    p.$active &&
    css`
      color: var(--brand);

      &::after {
        content: '';
        position: absolute;
        left: 14px;
        right: 14px;
        bottom: -1px;
        height: 2px;
        background: var(--brand);
        border-radius: 2px 2px 0 0;
      }
    `}
`;

export type TabKey = 'metrics' | 'data-model' | 'cubes' | 'models';

const TAB_PATHS: Record<TabKey, string> = {
  metrics: '/catalog',
  'data-model': '/catalog/data-model',
  cubes: '/catalog/cubes',
  models: '/catalog/models',
};

function resolveActive(pathname: string): TabKey {
  if (pathname.endsWith('/data-model') || pathname.includes('/data-model/')) return 'data-model';
  if (pathname.endsWith('/cubes') || pathname.includes('/cubes/')) return 'cubes';
  if (pathname.endsWith('/models') || pathname.includes('/models/')) return 'models';
  return 'metrics';
}

const TAB_LABELS: Record<TabKey, string> = {
  metrics: 'tabs.metrics',
  'data-model': 'tabs.dataModel',
  cubes: 'tabs.cubes',
  models: 'tabs.models',
};

const TAB_ORDER: TabKey[] = ['metrics', 'data-model', 'cubes', 'models'];

export function CatalogTabs() {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const active = resolveActive(location.pathname);

  function go(key: TabKey) {
    const target = TAB_PATHS[key];
    if (location.pathname === target) return;
    history.push(target);
  }

  return (
    <Strip role="tablist" aria-label={t('nav.catalog')}>
      {TAB_ORDER.map((key) => (
        <TabButton
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          $active={active === key}
          onClick={() => go(key)}
        >
          {t(TAB_LABELS[key])}
        </TabButton>
      ))}
    </Strip>
  );
}

export { resolveActive as resolveCatalogTab };
