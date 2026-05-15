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

const Body = styled.div`
  display: flex;
  flex-direction: column;
`;

export function QueryStatePillBar() {
  const ctx = useQueryBuilderContext();
  const {
    query,
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

  return (
    <Card>
      <Header>
        <HeaderLeft>
          <Title>Query</Title>
          <LiveBadge>Live</LiveBadge>
        </HeaderLeft>
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
