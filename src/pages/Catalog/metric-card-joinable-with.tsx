/**
 * MetricCardJoinableWith — for each declared join on the source cube, shows
 * the target cube + measure/dim counts + a truncated SQL preview. Counts
 * come from looking the join target up in the loaded `allCubes` array; if
 * the target isn't exposed (filtered by visibility), counts are omitted and
 * only the name + join SQL are rendered.
 */

import type { CatalogCube, CatalogJoin } from './use-catalog-meta';
import { Section, SectionTitle, Code, Chip, MutedText, SqlPreview } from './metric-card-styles';
import styled from 'styled-components';

const JoinEntry = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border-card);
  &:last-child {
    border-bottom: 0;
  }
`;

const JoinHead = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

interface Props {
  cube: CatalogCube;
  cubesByName: Map<string, CatalogCube>;
}

function describeJoin(join: CatalogJoin, target: CatalogCube | undefined) {
  if (!target) {
    return { measures: null, dimensions: null };
  }
  return {
    measures: target.measures.length,
    dimensions: target.dimensions.length,
  };
}

export function MetricCardJoinableWith({ cube, cubesByName }: Props) {
  const joins = cube.joins ?? [];
  if (joins.length === 0) return null;

  return (
    <Section>
      <SectionTitle>Joinable with ({joins.length})</SectionTitle>
      {joins.map((j) => {
        const target = cubesByName.get(j.name);
        const counts = describeJoin(j, target);
        return (
          <JoinEntry key={j.name}>
            <JoinHead>
              <Code>{j.name}</Code>
              {j.relationship && <Chip>{j.relationship}</Chip>}
              {counts.measures != null && (
                <MutedText>
                  {counts.measures} measures · {counts.dimensions} dimensions
                </MutedText>
              )}
              {!target && <MutedText>(target not in current schema)</MutedText>}
            </JoinHead>
            <SqlPreview>{j.sql}</SqlPreview>
          </JoinEntry>
        );
      })}
    </Section>
  );
}
