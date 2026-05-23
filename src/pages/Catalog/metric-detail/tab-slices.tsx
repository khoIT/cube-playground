import styled from 'styled-components';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Wrap = styled.section`
  padding: 20px 24px;
`;

const Empty = styled.div`
  padding: 30px 0;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 12px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
`;

const SliceCard = styled.div`
  padding: 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-card, #ffffff);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
`;

const Label = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-muted, #737373);
  letter-spacing: 0.05em;
  margin-bottom: 6px;
  font-family: var(--font-sans);
`;

export function TabSlices({ metric }: { metric: BusinessMetric }) {
  const concepts = metric.related_concepts ?? [];
  return (
    <Wrap>
      <Label>Recommended slices ({concepts.length})</Label>
      {concepts.length === 0 ? (
        <Empty>No related concepts declared for this metric.</Empty>
      ) : (
        <Grid>
          {concepts.map((ref) => (
            <SliceCard key={ref}>{ref}</SliceCard>
          ))}
        </Grid>
      )}
    </Wrap>
  );
}
