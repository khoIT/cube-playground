/**
 * DataModelGrid — virtualisation-free responsive grid of ConceptCards.
 * Cube /meta typically returns < 500 concepts per game; a plain grid is
 * fine for v1. Add windowing later if profiling shows scroll lag.
 */

import styled from 'styled-components';

import type { Concept } from './concept-types';
import { ConceptCard } from './concept-card';

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 12px 16px;
  overflow-y: auto;
  flex: 1;
`;

const Empty = styled.div`
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

interface DataModelGridProps {
  concepts: Concept[];
  usageMap: Map<string, number>;
}

export function DataModelGrid({ concepts, usageMap }: DataModelGridProps) {
  if (concepts.length === 0) {
    return <Empty>No concepts match the current filters.</Empty>;
  }
  return (
    <Grid>
      {concepts.map((c) => (
        <ConceptCard
          key={`${c.type}:${c.fqn}`}
          concept={c}
          usedByCount={usageMap.get(c.fqn) ?? 0}
        />
      ))}
    </Grid>
  );
}
