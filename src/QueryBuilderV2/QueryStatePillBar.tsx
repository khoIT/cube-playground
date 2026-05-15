import { Play } from 'lucide-react';
import { useMemo } from 'react';
import styled from 'styled-components';

import { useQueryBuilderContext } from './context';
import { DateRangeStrip } from './components/date-range-strip';
import {
  MemberPillRow,
  PillItem,
} from './components/member-pill-row';

const Card = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  margin: 12px;
  overflow: hidden;
  font-family: var(--font-sans);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-card);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
`;

const LiveBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: var(--success);
  background: rgba(0, 150, 136, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;

const RunButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--brand);
  color: var(--text-on-brand);
  border: 1px solid var(--brand);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  height: 30px;
  padding: 0 14px;
  cursor: pointer;

  &:hover {
    background: var(--brand-hover);
    border-color: var(--brand-hover);
  }

  &:disabled {
    background: var(--neutral-300);
    border-color: var(--neutral-300);
    cursor: not-allowed;
  }
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
`;

export function QueryStatePillBar() {
  const ctx = useQueryBuilderContext();
  const {
    query,
    runQuery,
    isLoading,
    dimensions,
    measures,
    grouping,
    filters,
  } = ctx;

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

  const filterItems = useMemo<PillItem[]>(() => {
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

  const hasMembers =
    dimensionItems.length + measureItems.length + timeItems.length > 0;

  return (
    <Card>
      <Header>
        <HeaderLeft>
          <Title>Query</Title>
          <LiveBadge>Live</LiveBadge>
        </HeaderLeft>
        <RunButton
          type="button"
          onClick={() => runQuery()}
          disabled={isLoading || !hasMembers}
        >
          <Play size={13} strokeWidth={2.5} />
          {isLoading ? 'Running…' : 'Run query'}
        </RunButton>
      </Header>
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
        <MemberPillRow
          kind="time"
          items={timeItems}
          emptyHint="No time dimensions yet."
        />
        <MemberPillRow
          kind="filter"
          items={filterItems}
          emptyHint="No filters."
        />
        <DateRangeStrip />
      </Body>
    </Card>
  );
}
