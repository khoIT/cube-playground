import { ReactNode, useMemo } from 'react';
import styled from 'styled-components';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Card } from '../components/AppPanes';
import { useQueryBuilderContext } from './context';
import { useLocalStorage } from './hooks';
import { DateRangeStrip } from './components/date-range-strip';
import {
  MemberPillRow,
  PillItem,
} from './components/member-pill-row';
import { QueryRunButton, QueryRunStatus } from './QueryBuilderToolBar';

const QueryCard = styled(Card)`
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
`;

const Header = styled.div<{ $collapsed: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: ${(p) => (p.$collapsed ? '0' : '1px solid var(--border-card)')};
  flex-shrink: 0;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  margin-left: auto;
`;

const ToggleButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
`;

const LiveBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  color: var(--live-badge-text);
  background: var(--live-badge-bg);
  border: 1px solid var(--live-badge-border);
  padding: 2px 8px 2px 7px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.4px;

  &::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--live-badge-dot);
    animation: live-dot-pulse 1.8s ease-in-out infinite;
  }

  @keyframes live-dot-pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.55;
      transform: scale(0.85);
    }
  }
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
`;

const FilterRow = styled.div`
  display: grid;
  grid-template-columns: var(--qrow-label-width) 1fr;
  align-items: start;
  gap: var(--qrow-gap);
  padding: var(--qrow-padding-y) 12px;
  border-bottom: var(--qrow-divider);

  &:last-child {
    border-bottom: 0;
  }
`;

const FilterRowLabel = styled.span`
  font-family: var(--font-sans);
  font-size: var(--qrow-label-size);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--qrow-label-spacing);
  line-height: var(--pill-height);
  padding-top: 2px;
`;

type Props = {
  filterSlot?: ReactNode;
};

export function QueryStatePillBar({ filterSlot }: Props) {
  const ctx = useQueryBuilderContext();
  const {
    query,
    dimensions,
    measures,
    grouping,
    filters,
  } = ctx;

  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    'QueryBuilder:Query:collapsed',
    false
  );

  const dimensionItems = useMemo<PillItem[]>(() => {
    return (query.dimensions ?? []).map((member) => ({
      key: `dim:${member}`,
      member,
      onRemove: () => dimensions.remove(member),
    }));
  }, [query.dimensions, dimensions]);

  const measureItems = useMemo<PillItem[]>(() => {
    return (query.measures ?? []).map((member) => ({
      key: `meas:${member}`,
      member,
      onRemove: () => measures.remove(member),
    }));
  }, [query.measures, measures]);

  const timeItems = useMemo<PillItem[]>(() => {
    return (query.timeDimensions ?? []).map((td) => ({
      key: `time:${td.dimension}`,
      member: td.dimension,
      granularity: td.granularity ?? undefined,
      onRemove: () => grouping.remove(td.dimension),
    }));
  }, [query.timeDimensions, grouping]);

  const fallbackFilterItems = useMemo<PillItem[]>(() => {
    return (query.filters ?? []).map((f, index) => {
      const memberName = 'member' in f && f.member ? f.member : 'filters';
      const op = (f as { operator?: string }).operator ?? '';
      const values = Array.isArray((f as { values?: unknown[] }).values)
        ? ((f as { values?: unknown[] }).values as unknown[]).join(', ')
        : '';
      const label = [memberName, op, values].filter(Boolean).join(' ');
      return {
        key: `filter:${index}:${memberName}`,
        member: typeof memberName === 'string' ? memberName : 'filters',
        label,
        onRemove: () => filters.remove(index),
      };
    });
  }, [query.filters, filters]);

  return (
    <QueryCard>
      <Header $collapsed={collapsed}>
        <HeaderLeft>
          <QueryRunButton />
          <LiveBadge>Live</LiveBadge>
        </HeaderLeft>
        <HeaderRight>
          <QueryRunStatus />
          <ToggleButton
            type="button"
            aria-label={collapsed ? 'Expand Query' : 'Collapse Query'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight size={14} strokeWidth={2.5} />
            ) : (
              <ChevronDown size={14} strokeWidth={2.5} />
            )}
          </ToggleButton>
        </HeaderRight>
      </Header>
      {!collapsed ? (
        <Body>
          <MemberPillRow
            kind="dimension"
            items={dimensionItems}
            emptyHint="No dimensions yet. Add from the sidebar."
          />
          <MemberPillRow
            kind="measure"
            items={measureItems}
            emptyHint="No measures yet. Add from the sidebar."
          />
          {timeItems.length > 0 ? (
            <MemberPillRow
              kind="time"
              items={timeItems}
              emptyHint="No time dimensions yet."
              addLabel="Add time"
            />
          ) : null}
          {filterSlot ? (
            <FilterRow>
              <FilterRowLabel>Filters</FilterRowLabel>
              <div>{filterSlot}</div>
            </FilterRow>
          ) : (
            <MemberPillRow
              kind="filter"
              items={fallbackFilterItems}
              emptyHint="No filters."
            />
          )}
          <DateRangeStrip />
        </Body>
      ) : null}
    </QueryCard>
  );
}
