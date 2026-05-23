/**
 * Concept Slices tab — type-aware content.
 *
 *  • measure  → rehomed how-to-slice + joinable-with + similar-measures.
 *  • dimension → list of measures reachable on the same cube.
 *  • segment  → segment description + "members of the active definition" hint
 *               (full member preview lives in Segments → Detail).
 *
 * The existing metric-card-* modules are imported in-place rather than
 * physically rehomed for v1; they're already pure presentational and don't
 * need their own subdir until Phase 6 wizard-shell work.
 */

import styled from 'styled-components';

import { MetricCardHowToSlice } from '../metric-card-how-to-slice';
import { MetricCardJoinableWith } from '../metric-card-joinable-with';
import { MetricCardSimilarMeasures } from '../metric-card-similar-measures';
import type { Concept } from '../data-model-tab/concept-types';
import type { CatalogCube } from '../use-catalog-meta';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
`;

const Empty = styled.div`
  padding: 40px 24px;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 13px;
`;

interface TabSlicesConceptProps {
  concept: Concept;
  cube: CatalogCube | null;
  cubesByName: Map<string, CatalogCube>;
}

function MeasureSlices({
  concept,
  cube,
  cubesByName,
}: TabSlicesConceptProps & { cube: CatalogCube }) {
  // /meta returns measure.name as the full FQN — compare against concept.fqn
  // so the lookup survives the local-name normalisation in conceptsFromCube.
  const measure = cube.measures.find((m) => m.name === concept.fqn);
  return (
    <Wrap>
      <MetricCardHowToSlice cube={cube} />
      <MetricCardJoinableWith cube={cube} cubesByName={cubesByName} />
      {measure && <MetricCardSimilarMeasures cube={cube} measure={measure} />}
    </Wrap>
  );
}

function DimensionSlices({ cube }: { cube: CatalogCube }) {
  if (cube.measures.length === 0) {
    return <Empty>No measures available on this cube.</Empty>;
  }
  return (
    <Wrap>
      <MetricCardHowToSlice cube={cube} />
    </Wrap>
  );
}

function SegmentSlices({ concept }: { concept: Concept }) {
  return (
    <Empty>
      Segment definition lives in the Cube file. Use the Segments tab to view
      members or push to activation.
      <div style={{ marginTop: 8, fontFamily: 'var(--font-mono, monospace)' }}>
        {concept.fqn}
      </div>
    </Empty>
  );
}

export function TabSlicesConcept(props: TabSlicesConceptProps) {
  if (!props.cube) {
    return <Empty>Cube not found in /meta. Switch active game?</Empty>;
  }
  if (props.concept.type === 'measure') {
    return <MeasureSlices {...props} cube={props.cube} />;
  }
  if (props.concept.type === 'dimension') {
    return <DimensionSlices cube={props.cube} />;
  }
  return <SegmentSlices concept={props.concept} />;
}
