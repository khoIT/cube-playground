/**
 * GlossaryFilterBar — collapsible, inline facet rows for the glossary index.
 *
 * Separates the three independent axes a term lives on so they read as distinct
 * questions rather than one undifferentiated badge soup:
 *   - Status   — is it published?   (draft / official)
 *   - Wiring   — is it bound to data? (wired / definition-only)
 *   - Category — what is it filed under? (taxonomy)
 *
 * Reuses the shared FilterPillStack/FilterPillRow primitives + collapse store so
 * the bar matches the Metrics catalog filter surface users already know. Every
 * option renders as a visible pill (discoverability over compactness); empty
 * selection on an axis means "all".
 */

import React from 'react';
import styled from 'styled-components';
import { ChevronDown, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  FilterPillRow,
  FilterPillStack,
} from '../../../shared/filter-chip-bar/filter-chip-bar';
import {
  getFilterBarCollapsed,
  onFilterBarCollapsedChange,
  setFilterBarCollapsed,
} from '../../../shared/filter-chip-bar/filter-bar-collapsed-store';
import type { GlossaryStatus } from '../../../api/glossary-client';
import type { WiringFacet } from './glossary-filter';

interface Props {
  statuses: Set<GlossaryStatus>;
  onStatusesChange: (next: Set<GlossaryStatus>) => void;
  wiring: Set<WiringFacet>;
  onWiringChange: (next: Set<WiringFacet>) => void;
  categories: Set<string>;
  onCategoriesChange: (next: Set<string>) => void;
  /** All category values present in the loaded term set. */
  availableCategories: ReadonlyArray<string>;
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const HeaderRow = styled.button`
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  margin: 0;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--brand);
  }
`;

const Chevron = styled.span<{ $collapsed: boolean }>`
  display: inline-flex;
  transform: rotate(${(p) => (p.$collapsed ? '-90deg' : '0deg')});
  transition: transform 0.15s ease;
`;

const ActiveCount = styled.span`
  color: var(--brand);
  font-weight: 600;
`;

const ClearBtn = styled.button`
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 0 4px;
  margin-left: 2px;

  &:hover {
    color: var(--brand);
    text-decoration: underline;
  }
`;

/**
 * Wiring pills use the info/blue token pair so they read as the same axis as the
 * blue "Wired" badge on each row — a deliberate color link between the filter and
 * the thing it filters. (Status / Category keep the default brand pills.)
 */
const WiringPill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border: 1px solid ${(p) => (p.$active ? 'var(--info-ink)' : 'var(--border-card)')};
  border-radius: var(--radius-pill, 999px);
  background: ${(p) => (p.$active ? 'var(--info-soft)' : 'var(--bg-card)')};
  color: ${(p) => (p.$active ? 'var(--info-ink)' : 'var(--text-secondary)')};
  font-size: 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--info-ink);
    color: var(--info-ink);
  }
`;

/** Per-pill tooltip text explaining each wiring value (replaces the inline gloss). */
const WIRING_TOOLTIP: Record<WiringFacet, string> = {
  wired: 'Resolves to live data — a cube, measure, or filter',
  definition: 'Prose only — no data binding',
};

const LabelWithInfo = styled.span`
  display: inline-flex;
  align-items: center;
`;

/**
 * Visible help affordance next to the Wiring label. Uses a styled CSS tooltip
 * (shown on hover/focus) rather than the native `title` — native titles are
 * unreliable (delayed, intermittent) and `cursor: help` renders a confusing
 * "?" pointer. The bubble lives in normal flow (the filter bar is in the page
 * header, not a scroll container) so it isn't clipped.
 */
const InfoTooltipWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  color: var(--text-muted);
  vertical-align: middle;

  &:hover,
  &:focus-within {
    color: var(--info-ink);
  }
  &:hover .glossary-tip,
  &:focus-within .glossary-tip {
    opacity: 1;
    visibility: visible;
  }
`;

const TooltipBubble = styled.span.attrs({ className: 'glossary-tip', role: 'tooltip' })`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 1000;
  width: max-content;
  max-width: 260px;
  padding: 6px 9px;
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 8px);
  box-shadow: var(--shadow-md);
  /* Reset the uppercase/letter-spacing inherited from the pill-row label. */
  font-size: 11px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  line-height: 1.45;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease;
  pointer-events: none;
`;

export function GlossaryFilterBar({
  statuses,
  onStatusesChange,
  wiring,
  onWiringChange,
  categories,
  onCategoriesChange,
  availableCategories,
}: Props) {
  const { t } = useTranslation();

  const [collapsed, setCollapsed] = React.useState<boolean>(() =>
    getFilterBarCollapsed('glossary'),
  );
  React.useEffect(() => onFilterBarCollapsedChange('glossary', setCollapsed), []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    setFilterBarCollapsed('glossary', next);
  }

  const active = statuses.size + wiring.size + categories.size;

  function clearAll() {
    onStatusesChange(new Set());
    onWiringChange(new Set());
    onCategoriesChange(new Set());
  }

  const statusOptions = [
    { value: 'draft' as GlossaryStatus, label: t('glossary.status.draft', { defaultValue: 'Draft' }) },
    { value: 'official' as GlossaryStatus, label: t('glossary.status.official', { defaultValue: 'Official' }) },
  ];

  const wiringOptions = [
    { value: 'wired' as WiringFacet, label: t('glossary.wiring.wired', { defaultValue: 'Wired' }) },
    { value: 'definition' as WiringFacet, label: t('glossary.wiring.definition', { defaultValue: 'Definition' }) },
  ];

  const categoryOptions = availableCategories.map((c) => ({ value: c, label: c }));

  return (
    <Container aria-label={t('glossary.filters.label', { defaultValue: 'Glossary filters' })}>
      <HeaderRow type="button" onClick={toggleCollapsed} aria-expanded={!collapsed}>
        <Chevron $collapsed={collapsed}>
          <ChevronDown size={12} />
        </Chevron>
        {t('glossary.filters.title', { defaultValue: 'Filters' })}
        {active > 0 && (
          <>
            <ActiveCount>· {active} active</ActiveCount>
            <ClearBtn
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
            >
              {t('glossary.filters.clear', { defaultValue: 'Clear' })}
            </ClearBtn>
          </>
        )}
      </HeaderRow>

      {!collapsed && (
        <FilterPillStack>
          <FilterPillRow
            label={t('glossary.filters.status', { defaultValue: 'Status' })}
            options={statusOptions}
            selected={statuses}
            onChange={onStatusesChange}
          />
          <FilterPillRow
            label={
              <LabelWithInfo>
                {t('glossary.filters.wiring', { defaultValue: 'Wiring' })}
                <InfoTooltipWrap
                  tabIndex={0}
                  aria-label={t('glossary.wiring.hint', {
                    defaultValue:
                      'Wired = resolves to live data (a cube, measure, or filter). Definition = prose only.',
                  })}
                >
                  <Info size={12} aria-hidden />
                  <TooltipBubble>
                    {t('glossary.wiring.hint', {
                      defaultValue:
                        'Wired = resolves to live data (a cube, measure, or filter). Definition = prose only.',
                    })}
                  </TooltipBubble>
                </InfoTooltipWrap>
              </LabelWithInfo>
            }
            options={wiringOptions}
            selected={wiring}
            onChange={onWiringChange}
            renderOption={(value, isActive, toggle) => (
              <WiringPill
                type="button"
                $active={isActive}
                aria-pressed={isActive}
                onClick={toggle}
                title={WIRING_TOOLTIP[value as WiringFacet]}
              >
                {wiringOptions.find((o) => o.value === value)?.label ?? String(value)}
              </WiringPill>
            )}
          />
          <FilterPillRow
            label={t('glossary.filters.category', { defaultValue: 'Category' })}
            options={categoryOptions}
            selected={categories}
            onChange={onCategoriesChange}
            emptyHint={t('glossary.filters.noCategories', { defaultValue: 'No categories' })}
          />
        </FilterPillStack>
      )}
    </Container>
  );
}
