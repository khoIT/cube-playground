/**
 * Concept Overview tab — type-aware key/value list. Description if present,
 * agg type / format for measures, dim type for dimensions, source cube + (if
 * available) CDP projection hint.
 */

import styled from 'styled-components';

import type { Concept } from '../data-model-tab/concept-types';

const Wrap = styled.div`
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Grid = styled.dl`
  display: grid;
  grid-template-columns: 160px 1fr;
  row-gap: 6px;
  column-gap: 16px;
  margin: 0;
  font-size: 13px;

  dt {
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.05em;
    align-self: center;
  }
  dd {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
  }
`;

const Description = styled.p`
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.55;
`;

export function TabOverviewConcept({ concept }: { concept: Concept }) {
  return (
    <Wrap>
      {concept.description && <Description>{concept.description}</Description>}
      <Grid>
        <dt>Type</dt>
        <dd>{concept.type}</dd>
        <dt>Cube</dt>
        <dd>{concept.cube}</dd>
        <dt>FQN</dt>
        <dd>{concept.fqn}</dd>
        {concept.meta?.aggType && (
          <>
            <dt>Agg</dt>
            <dd>{concept.meta.aggType}</dd>
          </>
        )}
        {concept.meta?.format && (
          <>
            <dt>Format</dt>
            <dd>{concept.meta.format}</dd>
          </>
        )}
        {concept.meta?.dimensionType && (
          <>
            <dt>Dim type</dt>
            <dd>{concept.meta.dimensionType}</dd>
          </>
        )}
        {concept.meta?.source && (
          <>
            <dt>Source</dt>
            <dd>{concept.meta.source}</dd>
          </>
        )}
        {concept.meta?.cdpProjection && (
          <>
            <dt>CDP</dt>
            <dd>projectable</dd>
          </>
        )}
      </Grid>
    </Wrap>
  );
}
