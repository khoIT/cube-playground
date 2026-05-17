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

type TabKey = 'catalog' | 'models';

function resolveActive(pathname: string): TabKey {
  return pathname.endsWith('/models') ? 'models' : 'catalog';
}

export function CatalogTabs() {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const active = resolveActive(location.pathname);

  function go(key: TabKey) {
    const target = key === 'models' ? '/catalog/models' : '/catalog';
    if (location.pathname === target) return;
    history.push(target);
  }

  return (
    <Strip role="tablist" aria-label={t('nav.catalog')}>
      <TabButton
        type="button"
        role="tab"
        aria-selected={active === 'catalog'}
        $active={active === 'catalog'}
        onClick={() => go('catalog')}
      >
        {t('tabs.catalog')}
      </TabButton>
      <TabButton
        type="button"
        role="tab"
        aria-selected={active === 'models'}
        $active={active === 'models'}
        onClick={() => go('models')}
      >
        {t('tabs.models')}
      </TabButton>
    </Strip>
  );
}

export { resolveActive as resolveCatalogTab };
