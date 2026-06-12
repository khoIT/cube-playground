/**
 * DataModelSubtabs — sub-navigation within the Data Model surface.
 * Cubes (join graph + card grid) is the first tab and the default landing;
 * Schema (Cartographer), Concepts, Models, and Concept Map hang off explicit
 * subpaths.
 *
 * The top-level Data Model vs Metrics Catalog split lives in the sidebar
 * now — there is no longer a catalog-wide tab strip above the page.
 */
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

export type DataModelSubtab = 'schema' | 'concepts' | 'cubes' | 'models' | 'concept-map';

/**
 * Cubes is the leftmost subtab and the default landing for /catalog/data-model,
 * so it owns the root path (the join graph renders there, with ?view=grid for
 * the card grid). Schema moved to an explicit /schema URL; `?focus=` deep
 * links to the root are redirected to it by the Catalog dispatch.
 */
const TAB_PATHS: Record<DataModelSubtab, string> = {
  cubes:         '/catalog/data-model',
  schema:        '/catalog/data-model/schema',
  concepts:      '/catalog/data-model/concepts',
  models:        '/catalog/data-model/models',
  'concept-map': '/catalog/data-model/concept-map',
};

const TAB_LABELS: Record<DataModelSubtab, { i18n: string; fallback: string }> = {
  schema:        { i18n: 'tabs.schema',     fallback: 'Schema' },
  concepts:      { i18n: 'tabs.concepts',   fallback: 'Concepts' },
  cubes:         { i18n: 'tabs.cubes',      fallback: 'Cubes' },
  models:        { i18n: 'tabs.models',     fallback: 'Models' },
  'concept-map': { i18n: 'tabs.conceptMap', fallback: 'Concept Map' },
};

const TAB_ORDER: DataModelSubtab[] = ['cubes', 'schema', 'concepts', 'models', 'concept-map'];

/**
 * Resolve which subtab is active for a given pathname under /catalog/data-model.
 * Returns null if the pathname is not under the Data Model surface. The bare
 * root (any query string) resolves to cubes; the legacy /cubes subpath also
 * resolves to cubes (the dispatch redirects it to the root grid view).
 */
export function resolveDataModelSubtab(pathname: string): DataModelSubtab | null {
  if (pathname === '/catalog/data-model' || pathname.startsWith('/catalog/data-model/')) {
    if (pathname.includes('/data-model/concept-map')) return 'concept-map';
    if (pathname.includes('/data-model/concepts')) return 'concepts';
    if (pathname.includes('/data-model/schema')) return 'schema';
    if (pathname.includes('/data-model/models')) return 'models';
    return 'cubes';
  }
  return null;
}

export function DataModelSubtabs() {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const active = resolveDataModelSubtab(location.pathname) ?? 'schema';

  function go(key: DataModelSubtab) {
    const target = TAB_PATHS[key];
    if (location.pathname === target) return;
    history.push(target);
  }

  return (
    <Strip role="tablist" aria-label="Data Model">
      {TAB_ORDER.map((key) => (
        <TabButton
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          $active={active === key}
          onClick={() => go(key)}
        >
          {t(TAB_LABELS[key].i18n, { defaultValue: TAB_LABELS[key].fallback })}
        </TabButton>
      ))}
    </Strip>
  );
}
